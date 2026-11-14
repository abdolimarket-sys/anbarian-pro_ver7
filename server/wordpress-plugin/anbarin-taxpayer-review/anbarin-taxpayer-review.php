<?php
/**
 * Plugin Name: Anbarin Taxpayer Internal Review
 * Description: ذخیره امن پیش‌نویس‌های داخلی مؤدیان برای بازبینی؛ بدون ارسال به سازمان امور مالیاتی.
 * Version: 1.0.0
 * Requires PHP: 7.4
 */
if (!defined('ABSPATH')) { exit; }

final class Anbarin_Taxpayer_Internal_Review {
    const TABLE_SUFFIX = 'anbarin_tax_reviews';
    const ROUTE = '/taxpayer/reviews';
    const MAX_BYTES = 524288;
    const MAX_ITEMS = 500;

    public static function boot() {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_filter('rest_post_dispatch', [__CLASS__, 'private_cache_headers'], 10, 3);
    }

    public static function activate() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $charset = $wpdb->get_charset_collate();
        $sql = "CREATE TABLE {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            invoice_id varchar(191) NOT NULL,
            invoice_number varchar(100) NOT NULL DEFAULT '',
            captured_at varchar(40) NOT NULL,
            idempotency_key char(64) NOT NULL,
            review_json longtext NOT NULL,
            status varchar(24) NOT NULL DEFAULT 'internal_review',
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY idempotency_key (idempotency_key),
            KEY invoice_id (invoice_id),
            KEY created_at (created_at)
        ) {$charset};";
        dbDelta($sql);
    }

    public static function routes() {
        register_rest_route('anbarin/v1', self::ROUTE, [
            [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'create_review'],
                'permission_callback' => [__CLASS__, 'authorize'],
            ],
            [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'list_reviews'],
                'permission_callback' => [__CLASS__, 'authorize'],
                'args' => ['limit' => ['default' => 30, 'sanitize_callback' => 'absint']],
            ],
            [
                'methods' => 'DELETE',
                'callback' => [__CLASS__, 'delete_review'],
                'permission_callback' => [__CLASS__, 'authorize'],
                'args' => ['id' => ['required' => true, 'sanitize_callback' => 'absint']],
            ],
        ]);
    }

    public static function private_cache_headers($response, $server, $request) {
        if (strpos($request->get_route(), '/anbarin/v1/taxpayer/reviews') === 0 && $response instanceof WP_REST_Response) {
            $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            $response->header('Pragma', 'no-cache');
            $response->header('X-Content-Type-Options', 'nosniff');
        }
        return $response;
    }

    public static function authorize() {
        // احراز هویت را خود WordPress REST انجام می‌دهد (Cookie+Nonce یا Application Password).
        // فقط مدیر مجاز است؛ توکن ثابت و قابل استخراج از اپ در این افزونه وجود ندارد.
        return current_user_can('manage_options');
    }

    private static function fail($code, $message, $status) {
        return new WP_Error($code, $message, ['status' => $status]);
    }

    private static function valid_review($data) {
        if (!is_array($data) || ($data['documentKind'] ?? '') !== 'anbarin-taxpayer-internal-review' ||
            (int) ($data['documentVersion'] ?? 0) !== 1 || ($data['isOfficialOrganizationPayload'] ?? null) !== false) {
            return false;
        }
        if (empty($data['source']) || !is_array($data['source']) ||
            !is_string($data['source']['invoiceId'] ?? null) || trim($data['source']['invoiceId']) === '' ||
            !is_string($data['source']['invoiceNumber'] ?? null) ||
            !is_string($data['source']['capturedAt'] ?? null) || trim($data['source']['capturedAt']) === '') return false;
        if (empty($data['seller']) || !is_array($data['seller']) || empty($data['invoice']) || !is_array($data['invoice']) ||
            !isset($data['items']) || !is_array($data['items']) || count($data['items']) < 1 || count($data['items']) > self::MAX_ITEMS) return false;
        foreach (['netRial', 'taxRial', 'grossRial'] as $field) {
            if (!isset($data['invoice'][$field]) || !is_int($data['invoice'][$field]) || $data['invoice'][$field] < 0) return false;
        }
        foreach ($data['items'] as $item) {
            if (!is_array($item) || !is_string($item['description'] ?? null) ||
                !is_string($item['taxProductId'] ?? null) || trim($item['taxProductId']) === '' ||
                !is_string($item['taxUnit'] ?? null) || trim($item['taxUnit']) === '' ||
                !in_array($item['taxCategory'] ?? '', ['taxable', 'exempt', 'zero_rate'], true)) return false;
        }
        return true;
    }

    public static function create_review($request) {
        global $wpdb;
        $raw = $request->get_body();
        if (!is_string($raw) || strlen($raw) > self::MAX_BYTES) return self::fail('anbarin_review_too_large', 'حجم پیش‌نویس از حد مجاز بیشتر است.', 413);
        $data = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !self::valid_review($data)) {
            return self::fail('anbarin_review_invalid', 'ساختار پیش‌نویس داخلی معتبر نیست؛ این API قالب رسمی سازمان را نمی‌پذیرد.', 400);
        }
        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $invoice_id = sanitize_text_field($data['source']['invoiceId']);
        $invoice_number = sanitize_text_field($data['source']['invoiceNumber']);
        $captured_at = sanitize_text_field($data['source']['capturedAt']);
        $key = hash('sha256', $invoice_id . '|' . $captured_at);
        $existing = $wpdb->get_row($wpdb->prepare("SELECT id, status FROM {$table} WHERE idempotency_key = %s", $key), ARRAY_A);
        if ($existing) return new WP_REST_Response(['ok' => true, 'id' => (int) $existing['id'], 'duplicate' => true, 'status' => 'internal_review'], 200);

        // JSON تنها به‌عنوان سند بازبینی ذخیره می‌شود؛ هیچ درخواست شبکه‌ای به سازمان ارسال نمی‌شود.
        $stored = wp_json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($stored)) return self::fail('anbarin_review_encode_failed', 'آماده‌سازی سند برای ذخیره‌سازی ناموفق بود.', 500);
        $inserted = $wpdb->insert($table, [
            'invoice_id' => $invoice_id,
            'invoice_number' => $invoice_number,
            'captured_at' => $captured_at,
            'idempotency_key' => $key,
            'review_json' => $stored,
            'status' => 'internal_review',
            'created_at' => current_time('mysql', true),
        ], ['%s', '%s', '%s', '%s', '%s', '%s', '%s']);
        if (!$inserted) {
            $existing_id = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$table} WHERE idempotency_key = %s", $key));
            if ($existing_id) return new WP_REST_Response(['ok' => true, 'id' => (int) $existing_id, 'duplicate' => true, 'status' => 'internal_review'], 200);
            return self::fail('anbarin_review_store_failed', 'ذخیره پیش‌نویس در سرور انجام نشد.', 500);
        }
        return new WP_REST_Response(['ok' => true, 'id' => (int) $wpdb->insert_id, 'duplicate' => false, 'status' => 'internal_review'], 201);
    }

    public static function delete_review($request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        if ($id < 1) return self::fail('anbarin_review_invalid_id', 'شناسه پیش‌نویس معتبر نیست.', 400);
        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $deleted = $wpdb->delete($table, ['id' => $id], ['%d']);
        if ($deleted === false) return self::fail('anbarin_review_delete_failed', 'حذف پیش‌نویس از سرور ناموفق بود.', 500);
        if ($deleted === 0) return self::fail('anbarin_review_not_found', 'پیش‌نویس موردنظر پیدا نشد.', 404);
        return new WP_REST_Response(['ok' => true, 'deleted' => true, 'status' => 'internal_review_removed'], 200);
    }

    public static function list_reviews($request) {
        global $wpdb;
        $limit = min(100, max(1, (int) $request->get_param('limit')));
        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, invoice_id, invoice_number, captured_at, status, created_at FROM {$table} ORDER BY id DESC LIMIT %d", $limit
        ), ARRAY_A);
        return rest_ensure_response(['items' => is_array($rows) ? $rows : []]);
    }
}

register_activation_hook(__FILE__, ['Anbarin_Taxpayer_Internal_Review', 'activate']);
Anbarin_Taxpayer_Internal_Review::boot();
