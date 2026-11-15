<?php
/**
 * Plugin Name: Anbarin Taxpayer Submission Ledger
 * Description: دفتر ثبت ارسال سمت سرور برای صورتحساب‌های مؤدیان؛ ذخیره‌سازی پایدار، قید یکتایی، بازیابی وضعیت و کنترل انتقال وضعیت. ارسال واقعی به سامانه مؤدیان غیرفعال است.
 * Version: 1.0.0
 * Requires PHP: 7.4
 */
if (!defined('ABSPATH')) { exit; }

final class Anbarin_Taxpayer_Submission_Ledger {
    const TABLE_SUFFIX = 'anbarin_tax_submissions';
    const ROUTE_BASE = '/taxpayer/submissions';
    const MAX_EVENTS = 40;
    const MAX_MESSAGE = 240;
    const MAX_TRACKING = 160;
    const MAX_IDEMPOTENCY = 128;
    const MAX_REFERENCE = 191;

    /** ماشین حالت مطابق taxpayer-submission-ledger.ts فاز ۲۰ */
    private static $ALLOWED = [
        'draft' => ['ready'],
        'ready' => ['submitting'],
        'submitting' => ['accepted', 'rejected', 'unknown'],
        'accepted' => [],
        'rejected' => [],
        'unknown' => ['accepted', 'rejected', 'unknown'],
    ];

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
            record_id varchar(64) NOT NULL,
            invoice_reference varchar(191) NOT NULL,
            idempotency_key varchar(128) NOT NULL,
            environment varchar(16) NOT NULL,
            state varchar(16) NOT NULL DEFAULT 'ready',
            tracking_id varchar(160) DEFAULT NULL,
            last_message varchar(240) DEFAULT NULL,
            events_json longtext NOT NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uniq_env_idem (environment, idempotency_key),
            KEY state_idx (state),
            KEY invoice_ref_idx (invoice_reference),
            KEY updated_at_idx (updated_at)
        ) {$charset};";
        dbDelta($sql);
    }

    public static function routes() {
        $ns = 'anbarin/v1';
        register_rest_route($ns, self::ROUTE_BASE, [
            [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'reserve'],
                'permission_callback' => [__CLASS__, 'authorize'],
            ],
            [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'get_status'],
                'permission_callback' => [__CLASS__, 'authorize'],
                'args' => [
                    'environment' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
                    'idempotencyKey' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
                ],
            ],
            [
                'methods' => 'PATCH',
                'callback' => [__CLASS__, 'transition'],
                'permission_callback' => [__CLASS__, 'authorize'],
            ],
        ]);
        register_rest_route($ns, self::ROUTE_BASE . '/list', [
            [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'list_records'],
                'permission_callback' => [__CLASS__, 'authorize'],
                'args' => [
                    'limit' => ['default' => 30, 'sanitize_callback' => 'absint'],
                    'environment' => ['default' => '', 'sanitize_callback' => 'sanitize_text_field'],
                    'state' => ['default' => '', 'sanitize_callback' => 'sanitize_text_field'],
                ],
            ],
        ]);
    }

    public static function private_cache_headers($response, $server, $request) {
        if (strpos($request->get_route(), '/anbarin/v1/taxpayer/submissions') === 0 && $response instanceof WP_REST_Response) {
            $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            $response->header('Pragma', 'no-cache');
            $response->header('X-Content-Type-Options', 'nosniff');
        }
        return $response;
    }

    public static function authorize() {
        // فقط مدیر با احراز هویت استاندارد REST وردپرس (Cookie+Nonce یا Application Password).
        // Application Password را داخل اپ موبایل/وب عمومی قرار ندهید.
        return current_user_can('manage_options');
    }

    private static function fail($code, $message, $status) {
        return new WP_Error($code, $message, ['status' => $status]);
    }

    private static function now_mysql() {
        return current_time('mysql', true);
    }

    private static function now_iso() {
        return gmdate('Y-m-d\TH:i:s.000\Z');
    }

    private static function safe_text($value, $max) {
        if (!is_string($value)) return null;
        $clean = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $value);
        $clean = trim($clean);
        if ($clean === '') return null;
        return mb_substr($clean, 0, $max);
    }

    private static function valid_environment($env) {
        return in_array($env, ['sandbox', 'production'], true);
    }

    private static function valid_state($state) {
        return array_key_exists($state, self::$ALLOWED);
    }

    private static function valid_idempotency($key) {
        return is_string($key) && preg_match('/^[A-Za-z0-9._:-]{12,' . self::MAX_IDEMPOTENCY . '}$/', $key);
    }

    private static function encode_events(array $events) {
        $json = wp_json_encode($events, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return is_string($json) ? $json : '[]';
    }

    private static function decode_events($json) {
        if (!is_string($json) || $json === '') return [];
        $data = json_decode($json, true);
        return is_array($data) ? $data : [];
    }

    private static function row_to_record(array $row) {
        return [
            'id' => (string) $row['record_id'],
            'invoiceReference' => (string) $row['invoice_reference'],
            'idempotencyKey' => (string) $row['idempotency_key'],
            'environment' => (string) $row['environment'],
            'state' => (string) $row['state'],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
            'trackingId' => $row['tracking_id'] !== null && $row['tracking_id'] !== '' ? (string) $row['tracking_id'] : null,
            'lastMessage' => $row['last_message'] !== null && $row['last_message'] !== '' ? (string) $row['last_message'] : null,
            'events' => self::decode_events($row['events_json']),
            'dbId' => (int) $row['id'],
        ];
    }

    /**
     * رزرو اتمیک با قید UNIQUE(environment, idempotency_key).
     * اگر کلید از قبل وجود داشته باشد، رکورد موجود برگردانده می‌شود و created=false.
     * هیچ payload، کلید خصوصی، توکن یا راز ذخیره نمی‌شود.
     */
    public static function reserve($request) {
        global $wpdb;
        $body = $request->get_json_params();
        if (!is_array($body)) {
            return self::fail('anbarin_ledger_invalid_body', 'بدنه درخواست معتبر نیست.', 400);
        }

        $record_id = self::safe_text($body['id'] ?? '', 64);
        $invoice_reference = self::safe_text($body['invoiceReference'] ?? '', self::MAX_REFERENCE);
        $idempotency_key = isset($body['idempotencyKey']) ? (string) $body['idempotencyKey'] : '';
        $environment = isset($body['environment']) ? (string) $body['environment'] : '';

        if (!$record_id || !$invoice_reference) {
            return self::fail('anbarin_ledger_identity_required', 'شناسه رکورد و مرجع فاکتور الزامی است.', 400);
        }
        if (!self::valid_idempotency($idempotency_key)) {
            return self::fail('anbarin_ledger_idempotency_invalid', 'کلید جلوگیری از ارسال تکراری باید ۱۲ تا ۱۲۸ نویسه معتبر داشته باشد.', 400);
        }
        if (!self::valid_environment($environment)) {
            return self::fail('anbarin_ledger_environment_invalid', 'محیط باید sandbox یا production باشد.', 400);
        }

        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE environment = %s AND idempotency_key = %s",
            $environment, $idempotency_key
        ), ARRAY_A);

        if ($existing) {
            return new WP_REST_Response([
                'ok' => true,
                'created' => false,
                'record' => self::row_to_record($existing),
                'issues' => [[
                    'code' => 'duplicate_idempotency_key',
                    'message' => 'برای این کلید قبلاً رکورد وجود دارد؛ ارسال مجدد ایجاد نشد.',
                ]],
            ], 200);
        }

        $at = self::now_iso();
        $events = [[
            'id' => $record_id . ':prepared',
            'kind' => 'prepared',
            'at' => $at,
        ]];
        $now = self::now_mysql();

        $inserted = $wpdb->insert($table, [
            'record_id' => $record_id,
            'invoice_reference' => $invoice_reference,
            'idempotency_key' => $idempotency_key,
            'environment' => $environment,
            'state' => 'ready',
            'tracking_id' => null,
            'last_message' => null,
            'events_json' => self::encode_events($events),
            'created_at' => $now,
            'updated_at' => $now,
        ], ['%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s']);

        if (!$inserted) {
            // مسابقه: ممکن است همزمان درج شده باشد
            $existing = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$table} WHERE environment = %s AND idempotency_key = %s",
                $environment, $idempotency_key
            ), ARRAY_A);
            if ($existing) {
                return new WP_REST_Response([
                    'ok' => true,
                    'created' => false,
                    'record' => self::row_to_record($existing),
                    'issues' => [[
                        'code' => 'duplicate_idempotency_key',
                        'message' => 'برای این کلید قبلاً رکورد وجود دارد؛ ارسال مجدد ایجاد نشد.',
                    ]],
                ], 200);
            }
            return self::fail('anbarin_ledger_store_failed', 'ذخیره رکورد ارسال در سرور انجام نشد.', 500);
        }

        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id = %d", $wpdb->insert_id), ARRAY_A);
        return new WP_REST_Response([
            'ok' => true,
            'created' => true,
            'record' => self::row_to_record($row),
            'issues' => [],
        ], 201);
    }

    /** بازیابی وضعیت رکورد با environment + idempotencyKey */
    public static function get_status($request) {
        global $wpdb;
        $environment = (string) $request->get_param('environment');
        $idempotency_key = (string) $request->get_param('idempotencyKey');

        if (!self::valid_environment($environment)) {
            return self::fail('anbarin_ledger_environment_invalid', 'محیط باید sandbox یا production باشد.', 400);
        }
        if (!self::valid_idempotency($idempotency_key)) {
            return self::fail('anbarin_ledger_idempotency_invalid', 'کلید جلوگیری از ارسال تکراری معتبر نیست.', 400);
        }

        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE environment = %s AND idempotency_key = %s",
            $environment, $idempotency_key
        ), ARRAY_A);

        if (!$row) {
            return self::fail('anbarin_ledger_not_found', 'رکورد ارسال پیدا نشد.', 404);
        }

        return new WP_REST_Response([
            'ok' => true,
            'record' => self::row_to_record($row),
        ], 200);
    }

    /**
     * انتقال کنترل‌شده وضعیت.
     * از accepted/rejected به submitting مجاز نیست.
     * برای accepted شناسه پیگیری الزامی است.
     * ارسال واقعی به سامانه مؤدیان انجام نمی‌شود.
     */
    public static function transition($request) {
        global $wpdb;
        $body = $request->get_json_params();
        if (!is_array($body)) {
            return self::fail('anbarin_ledger_invalid_body', 'بدنه درخواست معتبر نیست.', 400);
        }

        $environment = isset($body['environment']) ? (string) $body['environment'] : '';
        $idempotency_key = isset($body['idempotencyKey']) ? (string) $body['idempotencyKey'] : '';
        $next = isset($body['state']) ? (string) $body['state'] : '';
        $tracking_id = self::safe_text($body['trackingId'] ?? null, self::MAX_TRACKING);
        $message = self::safe_text($body['message'] ?? null, self::MAX_MESSAGE);

        if (!self::valid_environment($environment) || !self::valid_idempotency($idempotency_key)) {
            return self::fail('anbarin_ledger_identity_invalid', 'محیط یا کلید یکتایی معتبر نیست.', 400);
        }
        if (!self::valid_state($next)) {
            return self::fail('anbarin_ledger_state_invalid', 'وضعیت مقصد معتبر نیست.', 400);
        }

        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE environment = %s AND idempotency_key = %s",
            $environment, $idempotency_key
        ), ARRAY_A);

        if (!$row) {
            return self::fail('anbarin_ledger_not_found', 'رکورد ارسال پیدا نشد.', 404);
        }

        $current_state = (string) $row['state'];
        $allowed = self::$ALLOWED[$current_state] ?? [];
        if (!in_array($next, $allowed, true)) {
            return self::fail(
                'anbarin_ledger_invalid_transition',
                sprintf('تغییر وضعیت از %s به %s مجاز نیست.', $current_state, $next),
                409
            );
        }

        if ($next === 'accepted' && !$tracking_id) {
            return self::fail('anbarin_ledger_tracking_required', 'برای وضعیت پذیرفته‌شده، شناسه پیگیری معتبر لازم است.', 400);
        }

        $events = self::decode_events($row['events_json']);
        $event_kind = ($next === 'submitting') ? 'submission_started' : $next;
        if (!empty($body['statusChecked'])) {
            $event_kind = 'status_checked';
        }
        $at = self::now_iso();
        $events[] = array_filter([
            'id' => $row['record_id'] . ':' . (count($events) + 1),
            'kind' => $event_kind,
            'at' => $at,
            'message' => $message,
        ], function ($v) { return $v !== null && $v !== ''; });

        if (count($events) > self::MAX_EVENTS) {
            $events = array_slice($events, -self::MAX_EVENTS);
        }

        $update = [
            'state' => $next,
            'updated_at' => self::now_mysql(),
            'events_json' => self::encode_events($events),
        ];
        $formats = ['%s', '%s', '%s'];

        if ($tracking_id) {
            $update['tracking_id'] = $tracking_id;
            $formats[] = '%s';
        }
        if ($message) {
            $update['last_message'] = $message;
            $formats[] = '%s';
        }

        $updated = $wpdb->update($table, $update, [
            'id' => (int) $row['id'],
            'state' => $current_state, // optimistic lock ساده
        ], $formats, ['%d', '%s']);

        if ($updated === false) {
            return self::fail('anbarin_ledger_update_failed', 'به‌روزرسانی وضعیت در سرور ناموفق بود.', 500);
        }
        if ($updated === 0) {
            // ممکن است همزمان تغییر کرده باشد
            $fresh = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id = %d", (int) $row['id']), ARRAY_A);
            return self::fail(
                'anbarin_ledger_conflict',
                'وضعیت رکورد هم‌زمان تغییر کرده است؛ دوباره بخوانید.',
                409
            );
        }

        $fresh = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id = %d", (int) $row['id']), ARRAY_A);
        return new WP_REST_Response([
            'ok' => true,
            'record' => self::row_to_record($fresh),
            'issues' => [],
            // صریح: این API هیچ درخواستی به سامانه مؤدیان ارسال نمی‌کند.
            'submissionDisabled' => true,
        ], 200);
    }

    public static function list_records($request) {
        global $wpdb;
        $limit = min(100, max(1, (int) $request->get_param('limit')));
        $environment = (string) $request->get_param('environment');
        $state = (string) $request->get_param('state');

        $table = $wpdb->prefix . self::TABLE_SUFFIX;
        $where = '1=1';
        $params = [];

        if (self::valid_environment($environment)) {
            $where .= ' AND environment = %s';
            $params[] = $environment;
        }
        if (self::valid_state($state)) {
            $where .= ' AND state = %s';
            $params[] = $state;
        }

        $params[] = $limit;
        $sql = "SELECT id, record_id, invoice_reference, idempotency_key, environment, state, tracking_id, last_message, created_at, updated_at
                FROM {$table} WHERE {$where} ORDER BY id DESC LIMIT %d";
        $prepared = $wpdb->prepare($sql, $params);
        $rows = $wpdb->get_results($prepared, ARRAY_A);

        $items = [];
        if (is_array($rows)) {
            foreach ($rows as $row) {
                $items[] = [
                    'dbId' => (int) $row['id'],
                    'id' => (string) $row['record_id'],
                    'invoiceReference' => (string) $row['invoice_reference'],
                    'idempotencyKey' => (string) $row['idempotency_key'],
                    'environment' => (string) $row['environment'],
                    'state' => (string) $row['state'],
                    'trackingId' => $row['tracking_id'] ?: null,
                    'lastMessage' => $row['last_message'] ?: null,
                    'createdAt' => (string) $row['created_at'],
                    'updatedAt' => (string) $row['updated_at'],
                ];
            }
        }

        return rest_ensure_response(['items' => $items]);
    }
}

register_activation_hook(__FILE__, ['Anbarin_Taxpayer_Submission_Ledger', 'activate']);
Anbarin_Taxpayer_Submission_Ledger::boot();
