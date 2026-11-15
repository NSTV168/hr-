export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
    });

  try {
    // 1. ดึงข้อมูลทั้งหมด (Logs + Schedules + Schedule Image Meta)
    if (path === 'sync' && method === 'GET') {
      const { results: logs } = await env.DB.prepare(
        'SELECT * FROM work_logs ORDER BY work_date DESC, created_at DESC'
      ).all();

      const { results: schedules } = await env.DB.prepare(
        'SELECT * FROM schedules ORDER BY work_date ASC'
      ).all();

      const meta = await env.DB.prepare(
        'SELECT * FROM schedule_meta WHERE id = 1'
      ).first();

      return json({
        logs: logs || [],
        schedules: schedules || [],
        imageUrl: meta?.image_key ? `/api/schedule-image?v=${encodeURIComponent(meta.updated_at || Date.now())}` : null,
        imageUpdatedAt: meta?.updated_at || null,
      });
    }

    // 2. บันทึก / อัปเดตประวัติการทำงานและโอที
    if (path === 'logs' && method === 'POST') {
      const body = await request.json();
      const id = body.id || crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO work_logs (id, work_date, shift, time_in, time_out, regular_hours, ot_hours, is_holiday, base_pay, ot_pay, shift_allowance, total_pay, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          work_date=excluded.work_date,
          shift=excluded.shift,
          time_in=excluded.time_in,
          time_out=excluded.time_out,
          regular_hours=excluded.regular_hours,
          ot_hours=excluded.ot_hours,
          is_holiday=excluded.is_holiday,
          base_pay=excluded.base_pay,
          ot_pay=excluded.ot_pay,
          shift_allowance=excluded.shift_allowance,
          total_pay=excluded.total_pay,
          note=excluded.note
      `).bind(
        id,
        body.work_date,
        body.shift,
        body.time_in,
        body.time_out,
        body.regular_hours,
        body.ot_hours,
        body.is_holiday ? 1 : 0,
        body.base_pay,
        body.ot_pay,
        body.shift_allowance,
        body.total_pay,
        body.note || ''
      ).run();

      return json({ success: true, id });
    }

    // 3. ลบรายการลงเวลา
    if (path.startsWith('logs/') && method === 'DELETE') {
      const id = path.split('/')[1];
      await env.DB.prepare('DELETE FROM work_logs WHERE id = ?').bind(id).run();
      return json({ success: true });
    }

    // 4. อัปเดตตารางกะงาน (รายวัน หรือ ยกชุด 2-4 สัปดาห์)
    if (path === 'schedules' && method === 'POST') {
      const body = await request.json();
      const items = Array.isArray(body.items) ? body.items : [body];
      const stmts = items.map((item) =>
        env.DB.prepare(`
          INSERT INTO schedules (work_date, shift_type, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(work_date) DO UPDATE SET shift_type=excluded.shift_type, updated_at=CURRENT_TIMESTAMP
        `).bind(item.work_date, item.shift_type)
      );
      if (stmts.length > 0) await env.DB.batch(stmts);
      return json({ success: true });
    }

    // 5. อัปโหลดรูปตารางงานขึ้น R2
    if (path === 'schedule-image' && method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('image');
      if (!file) return json({ error: 'ไม่พบไฟล์รูปภาพ' }, 400);

      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const key = `schedule-latest.${ext}`;
      const arrayBuffer = await file.arrayBuffer();

      await env.BUCKET.put(key, arrayBuffer, {
        httpMetadata: { contentType: file.type || 'image/jpeg' },
      });

      const now = new Date().toISOString();
      await env.DB.prepare(
        'UPDATE schedule_meta SET image_key = ?, updated_at = ? WHERE id = 1'
      ).bind(key, now).run();

      return json({
        success: true,
        imageUrl: `/api/schedule-image?v=${encodeURIComponent(now)}`,
        updatedAt: now,
      });
    }

    // 6. ดึงรูปตารางงานจาก R2 มาแสดง
    if (path === 'schedule-image' && method === 'GET') {
      const meta = await env.DB.prepare('SELECT image_key FROM schedule_meta WHERE id = 1').first();
      if (!meta?.image_key) return new Response('Not Found', { status: 404 });

      const obj = await env.BUCKET.get(meta.image_key);
      if (!obj) return new Response('Not Found', { status: 404 });

      const headers = new Headers(corsHeaders);
      obj.writeHttpMetadata(headers);
      headers.set('Cache-Control', 'no-cache');
      return new Response(obj.body, { headers });
    }

    // 7. ลบรูปตารางงานออกจาก R2
    if (path === 'schedule-image' && method === 'DELETE') {
      const meta = await env.DB.prepare('SELECT image_key FROM schedule_meta WHERE id = 1').first();
      if (meta?.image_key) {
        await env.BUCKET.delete(meta.image_key);
      }
      await env.DB.prepare('UPDATE schedule_meta SET image_key = NULL, updated_at = NULL WHERE id = 1').run();
      return json({ success: true });
    }

    return json({ error: 'Not Found' }, 404);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
