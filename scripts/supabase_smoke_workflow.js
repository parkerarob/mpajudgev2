#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const IDS = {
  admin: '11111111-1111-1111-1111-111111111111',
  chair: '22222222-2222-2222-2222-222222222222',
  judge1: '33333333-3333-3333-3333-333333333333',
  judge2: '44444444-4444-4444-4444-444444444444',
  judge3: '55555555-5555-5555-5555-555555555555',
  sightJudge: '66666666-6666-6666-6666-666666666666',
  director: '77777777-7777-7777-7777-777777777777',
  outsider: '88888888-8888-8888-8888-888888888888',
  district: '90000000-0000-0000-0000-000000000001',
  gradedListVersion: '90000000-0000-0000-0000-000000000002',
  site: '90000000-0000-0000-0000-000000000003',
  school: '90000000-0000-0000-0000-000000000004',
  ensemble: '90000000-0000-0000-0000-000000000005',
  event: '90000000-0000-0000-0000-000000000006',
  march: '90000000-0000-0000-0000-000000000007',
  piece1: '90000000-0000-0000-0000-000000000008',
  piece2: '90000000-0000-0000-0000-000000000009',
  eventEntry: '90000000-0000-0000-0000-00000000000a',
  judgeAssignment1: '90000000-0000-0000-0000-00000000000b',
  judgeAssignment2: '90000000-0000-0000-0000-00000000000c',
  judgeAssignment3: '90000000-0000-0000-0000-00000000000d',
  judgeAssignmentSight: '90000000-0000-0000-0000-00000000000e',
};

const SCORE_SHEET_IDS = {
  stage1: '91000000-0000-0000-0000-000000000001',
  stage2: '91000000-0000-0000-0000-000000000002',
  stage3: '91000000-0000-0000-0000-000000000003',
  sight: '91000000-0000-0000-0000-000000000004',
};

const DEV_LOGIN_PASSWORD = 'MPAapp-dev-2026!';

function buildConnectionConfig() {
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error('SUPABASE_DB_PASSWORD is required');
  }

  const poolerUrlPath = path.join(process.cwd(), 'supabase', '.temp', 'pooler-url');
  const poolerUrl = fs.readFileSync(poolerUrlPath, 'utf8').trim();
  const url = new URL(poolerUrl);

  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password,
    database: url.pathname.replace(/^\//, '') || 'postgres',
    ssl: { rejectUnauthorized: false },
  };
}

function authUserSql(id, email, displayName) {
  return {
    text: `
      insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      )
      values (
        '00000000-0000-0000-0000-000000000000',
        $1,
        'authenticated',
        'authenticated',
        $2,
        crypt($3, gen_salt('bf')),
        timezone('utc', now()),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', $4::text),
        timezone('utc', now()),
        timezone('utc', now())
      )
      on conflict (id) do update
      set
        email = excluded.email,
        raw_user_meta_data = excluded.raw_user_meta_data,
        updated_at = timezone('utc', now())
    `,
    values: [id, email, DEV_LOGIN_PASSWORD, displayName],
  };
}

function authIdentitySql(id, email) {
  return {
    text: `
      insert into auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        created_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        $1::uuid,
        jsonb_build_object(
          'sub', $1::text,
          'email', $2::text,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        $1::text,
        timezone('utc', now()),
        timezone('utc', now())
      )
      on conflict (provider, provider_id) do update
      set
        user_id = excluded.user_id,
        identity_data = excluded.identity_data,
        updated_at = timezone('utc', now())
    `,
    values: [id, email],
  };
}

async function runAsAuth(baseConfig, userId, callback) {
  const client = new Client(baseConfig);
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query('set local role authenticated');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

async function expectFailure(fn, messageFragment) {
  let failed = false;
  try {
    await fn();
  } catch (error) {
    failed = true;
    if (messageFragment && !String(error.message).includes(messageFragment)) {
      throw new Error(`Expected error containing "${messageFragment}", got: ${error.message}`);
    }
  }

  if (!failed) {
    throw new Error(`Expected failure${messageFragment ? ` containing "${messageFragment}"` : ''}`);
  }
}

async function main() {
  const baseConfig = buildConnectionConfig();
  const adminClient = new Client(baseConfig);
  await adminClient.connect();

  try {
    console.log('Resetting smoke data...');

    await adminClient.query('begin');

    await adminClient.query(
      `delete from public.shared_player_event_entries where shared_player_id in (select id from public.shared_players where event_id = $1)`,
      [IDS.event]
    );
    await adminClient.query(`delete from public.shared_players where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.school_repertoire_history where school_id = $1`, [IDS.school]);
    await adminClient.query(`delete from public.event_entry_fees where event_entry_id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.event_fees where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.event_entry_lunch_orders where event_entry_id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.event_lunch_items where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.event_entry_seating where event_entry_id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.event_entry_percussion_requests where event_entry_id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.instrumentation where event_entry_id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.repertoire where event_entry_id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.canonical_tapes where score_sheet_id = any($1::uuid[])`, [Object.values(SCORE_SHEET_IDS)]);
    await adminClient.query(`delete from public.tape_segments where score_sheet_id = any($1::uuid[])`, [Object.values(SCORE_SHEET_IDS)]);
    await adminClient.query(`delete from public.caption_ratings where score_sheet_id = any($1::uuid[])`, [Object.values(SCORE_SHEET_IDS)]);
    await adminClient.query(`delete from public.score_sheets where id = any($1::uuid[])`, [Object.values(SCORE_SHEET_IDS)]);
    await adminClient.query(`delete from public.packets where event_entry_id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.schedule_slots where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.event_day_start_times where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.event_volunteers where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.judge_assignments where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.event_chairs where event_id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.event_entries where id = $1`, [IDS.eventEntry]);
    await adminClient.query(`delete from public.events where id = $1`, [IDS.event]);
    await adminClient.query(`delete from public.ensembles where id = $1`, [IDS.ensemble]);
    await adminClient.query(`delete from public.director_schools where director_id = $1 or school_id = $2`, [IDS.director, IDS.school]);
    await adminClient.query(`delete from public.site_percussion_inventory where site_id = $1`, [IDS.site]);
    await adminClient.query(`delete from public.instruments where family_id in (select id from public.instrument_families where name like 'Smoke %')`);
    await adminClient.query(`delete from public.instrument_families where name like 'Smoke %'`);
    await adminClient.query(`delete from public.schools where id = $1`, [IDS.school]);
    await adminClient.query(`delete from public.sites where id = $1`, [IDS.site]);
    await adminClient.query(`delete from public.marches where id = $1`, [IDS.march]);
    await adminClient.query(`delete from public.pieces where id in ($1, $2)`, [IDS.piece1, IDS.piece2]);
    await adminClient.query(`delete from public.graded_list_versions where id = $1`, [IDS.gradedListVersion]);
    await adminClient.query(`delete from public.districts where id = $1`, [IDS.district]);
    const authUserIds = [
      IDS.admin,
      IDS.chair,
      IDS.judge1,
      IDS.judge2,
      IDS.judge3,
      IDS.sightJudge,
      IDS.director,
      IDS.outsider,
    ];

    await adminClient.query(`delete from auth.identities where user_id = any($1::uuid[])`, [authUserIds]);
    await adminClient.query(`delete from auth.users where id = any($1::uuid[])`, [authUserIds]);

    await adminClient.query(authUserSql(IDS.admin, 'smoke-admin@example.com', 'Smoke Admin'));
    await adminClient.query(authUserSql(IDS.chair, 'smoke-chair@example.com', 'Smoke Chair'));
    await adminClient.query(authUserSql(IDS.judge1, 'smoke-judge1@example.com', 'Smoke Judge 1'));
    await adminClient.query(authUserSql(IDS.judge2, 'smoke-judge2@example.com', 'Smoke Judge 2'));
    await adminClient.query(authUserSql(IDS.judge3, 'smoke-judge3@example.com', 'Smoke Judge 3'));
    await adminClient.query(authUserSql(IDS.sightJudge, 'smoke-sight@example.com', 'Smoke Sight Judge'));
    await adminClient.query(authUserSql(IDS.director, 'smoke-director@example.com', 'Smoke Director'));
    await adminClient.query(authUserSql(IDS.outsider, 'smoke-outsider@example.com', 'Smoke Outsider'));

    await adminClient.query(authIdentitySql(IDS.admin, 'smoke-admin@example.com'));
    await adminClient.query(authIdentitySql(IDS.chair, 'smoke-chair@example.com'));
    await adminClient.query(authIdentitySql(IDS.judge1, 'smoke-judge1@example.com'));
    await adminClient.query(authIdentitySql(IDS.judge2, 'smoke-judge2@example.com'));
    await adminClient.query(authIdentitySql(IDS.judge3, 'smoke-judge3@example.com'));
    await adminClient.query(authIdentitySql(IDS.sightJudge, 'smoke-sight@example.com'));
    await adminClient.query(authIdentitySql(IDS.director, 'smoke-director@example.com'));
    await adminClient.query(authIdentitySql(IDS.outsider, 'smoke-outsider@example.com'));

    await adminClient.query(`update public.users set is_admin = true where id = $1`, [IDS.admin]);

    await adminClient.query(
      `insert into public.districts (id, name, slug) values ($1, $2, $3)
       on conflict (id) do update set name = excluded.name, slug = excluded.slug`,
      [IDS.district, 'Smoke Eastern', 'smoke-eastern']
    );

    await adminClient.query(
      `insert into public.graded_list_versions (id, label, published_date, is_current)
       values ($1, $2, $3, false)
       on conflict (id) do update
       set label = excluded.label, published_date = excluded.published_date, is_current = excluded.is_current`,
      [IDS.gradedListVersion, 'Smoke 2026-2027', '2026-07-01']
    );

    await adminClient.query(
      `insert into public.sites (id, name, address, city, state)
       values ($1, $2, $3, $4, 'NC')
       on conflict (id) do update set name = excluded.name, address = excluded.address, city = excluded.city, state = excluded.state`,
      [IDS.site, 'Smoke Test Site', '123 Test St', 'Wilmington']
    );

    await adminClient.query(
      `insert into public.schools (id, name, district_id)
       values ($1, $2, $3)
       on conflict (id) do update set name = excluded.name, district_id = excluded.district_id`,
      [IDS.school, 'Smoke High School', IDS.district]
    );

    await adminClient.query(
      `insert into public.director_schools (director_id, school_id)
       values ($1, $2)
       on conflict do nothing`,
      [IDS.director, IDS.school]
    );

    await adminClient.query(
      `insert into public.ensembles (id, school_id, name)
       values ($1, $2, $3)
       on conflict (id) do update set school_id = excluded.school_id, name = excluded.name`,
      [IDS.ensemble, IDS.school, 'Smoke Wind Ensemble']
    );

    await adminClient.query(
      `insert into public.events (
         id, district_id, site_id, graded_list_version_id, name, season_year, start_date, end_date, schedule_start_time, status
       ) values ($1, $2, $3, $4, $5, $6, $7, null, $8, 'setup')
       on conflict (id) do update
       set district_id = excluded.district_id,
           site_id = excluded.site_id,
           graded_list_version_id = excluded.graded_list_version_id,
           name = excluded.name,
           season_year = excluded.season_year,
           start_date = excluded.start_date,
           end_date = excluded.end_date,
           schedule_start_time = excluded.schedule_start_time,
           status = excluded.status`,
      [IDS.event, IDS.district, IDS.site, IDS.gradedListVersion, 'Smoke Event', '2026-2027', '2027-03-20', '08:00:00']
    );

    await adminClient.query(
      `insert into public.event_chairs (event_id, user_id, role)
       values ($1, $2, 'chair')
       on conflict do nothing`,
      [IDS.event, IDS.chair]
    );

    await adminClient.query(
      `insert into public.judge_assignments (id, event_id, user_id, position)
       values ($1, $2, $3, $4)
       on conflict (id) do update set event_id = excluded.event_id, user_id = excluded.user_id, position = excluded.position`,
      [IDS.judgeAssignment1, IDS.event, IDS.judge1, 'stage1']
    );
    await adminClient.query(
      `insert into public.judge_assignments (id, event_id, user_id, position)
       values ($1, $2, $3, $4)
       on conflict (id) do update set event_id = excluded.event_id, user_id = excluded.user_id, position = excluded.position`,
      [IDS.judgeAssignment2, IDS.event, IDS.judge2, 'stage2']
    );
    await adminClient.query(
      `insert into public.judge_assignments (id, event_id, user_id, position)
       values ($1, $2, $3, $4)
       on conflict (id) do update set event_id = excluded.event_id, user_id = excluded.user_id, position = excluded.position`,
      [IDS.judgeAssignment3, IDS.event, IDS.judge3, 'stage3']
    );
    await adminClient.query(
      `insert into public.judge_assignments (id, event_id, user_id, position)
       values ($1, $2, $3, $4)
       on conflict (id) do update set event_id = excluded.event_id, user_id = excluded.user_id, position = excluded.position`,
      [IDS.judgeAssignmentSight, IDS.event, IDS.sightJudge, 'sight_reading']
    );

    await adminClient.query(
      `insert into public.marches (id, title, composer, is_user_submitted, submitted_by)
       values ($1, $2, $3, false, null)
       on conflict (id) do update set title = excluded.title, composer = excluded.composer, is_user_submitted = excluded.is_user_submitted, submitted_by = excluded.submitted_by`,
      [IDS.march, 'Smoke March', 'Smoke Composer']
    );

    await adminClient.query(
      `insert into public.pieces (
         id, graded_list_version_id, grade, title, composer, publisher, distributor, special_instructions, is_masterwork, status
       ) values ($1, $2, 'III', $3, $4, 'Smoke Publisher', 'Smoke Distributor', null, false, 'active')
       on conflict (id) do update
       set graded_list_version_id = excluded.graded_list_version_id,
           grade = excluded.grade,
           title = excluded.title,
           composer = excluded.composer,
           publisher = excluded.publisher,
           distributor = excluded.distributor,
           special_instructions = excluded.special_instructions,
           is_masterwork = excluded.is_masterwork,
           status = excluded.status`,
      [IDS.piece1, IDS.gradedListVersion, 'Smoke Selection One', 'Composer One']
    );

    await adminClient.query(
      `insert into public.pieces (
         id, graded_list_version_id, grade, title, composer, publisher, distributor, special_instructions, is_masterwork, status
       ) values ($1, $2, 'III', $3, $4, 'Smoke Publisher', 'Smoke Distributor', null, false, 'active')
       on conflict (id) do update
       set graded_list_version_id = excluded.graded_list_version_id,
           grade = excluded.grade,
           title = excluded.title,
           composer = excluded.composer,
           publisher = excluded.publisher,
           distributor = excluded.distributor,
           special_instructions = excluded.special_instructions,
           is_masterwork = excluded.is_masterwork,
           status = excluded.status`,
      [IDS.piece2, IDS.gradedListVersion, 'Smoke Selection Two', 'Composer Two']
    );

    await adminClient.query(
      `insert into public.event_entries (id, event_id, ensemble_id, registered_by, total_members)
       values ($1, $2, $3, $4, 42)
       on conflict (id) do update
       set event_id = excluded.event_id,
           ensemble_id = excluded.ensemble_id,
           registered_by = excluded.registered_by,
           total_members = excluded.total_members`,
      [IDS.eventEntry, IDS.event, IDS.ensemble, IDS.director]
    );

    await adminClient.query(
      `insert into public.repertoire (event_entry_id, piece_slot, march_id, piece_id)
       values ($1, 'march', $2, null)
       on conflict (event_entry_id, piece_slot) do update
       set march_id = excluded.march_id, piece_id = excluded.piece_id`,
      [IDS.eventEntry, IDS.march]
    );
    await adminClient.query(
      `insert into public.repertoire (event_entry_id, piece_slot, march_id, piece_id)
       values ($1, 'selection_1', null, $2)
       on conflict (event_entry_id, piece_slot) do update
       set march_id = excluded.march_id, piece_id = excluded.piece_id`,
      [IDS.eventEntry, IDS.piece1]
    );
    await adminClient.query(
      `insert into public.repertoire (event_entry_id, piece_slot, march_id, piece_id)
       values ($1, 'selection_2', null, $2)
       on conflict (event_entry_id, piece_slot) do update
       set march_id = excluded.march_id, piece_id = excluded.piece_id`,
      [IDS.eventEntry, IDS.piece2]
    );

    await adminClient.query('commit');

    const gradeCheck = await adminClient.query(
      `select grade from public.event_entries where id = $1`,
      [IDS.eventEntry]
    );
    if (gradeCheck.rows[0]?.grade !== 'III') {
      throw new Error(`Expected derived grade III, got ${gradeCheck.rows[0]?.grade}`);
    }
    console.log('Base smoke data seeded.');

    const directorPreRelease = await runAsAuth(baseConfig, IDS.director, async (client) => {
      const packets = await client.query(`select count(*)::int as count from public.packets`);
      const sheets = await client.query(`select count(*)::int as count from public.score_sheets`);
      return { packets: packets.rows[0].count, sheets: sheets.rows[0].count };
    });

    if (directorPreRelease.packets !== 0 || directorPreRelease.sheets !== 0) {
      throw new Error(`Director should not see unreleased packets or score sheets before release`);
    }

    const assignments = [
      { userId: IDS.judge1, assignmentId: IDS.judgeAssignment1, scoreSheetId: SCORE_SHEET_IDS.stage1, label: 'Stage 1' },
      { userId: IDS.judge2, assignmentId: IDS.judgeAssignment2, scoreSheetId: SCORE_SHEET_IDS.stage2, label: 'Stage 2' },
      { userId: IDS.judge3, assignmentId: IDS.judgeAssignment3, scoreSheetId: SCORE_SHEET_IDS.stage3, label: 'Stage 3' },
      { userId: IDS.sightJudge, assignmentId: IDS.judgeAssignmentSight, scoreSheetId: SCORE_SHEET_IDS.sight, label: 'Sight' },
    ];

    for (const assignment of assignments) {
      await runAsAuth(baseConfig, assignment.userId, async (client) => {
        await client.query(
          `insert into public.score_sheets (id, event_entry_id, judge_assignment_id)
           values ($1, $2, $3)
           on conflict (id) do nothing`,
          [assignment.scoreSheetId, IDS.eventEntry, assignment.assignmentId]
        );

        for (let order = 1; order <= 7; order += 1) {
          await client.query(
            `insert into public.caption_ratings (
               id, score_sheet_id, caption_order, caption_name, rating, modifier, comment
             ) values (
               gen_random_uuid(), $1, $2, $3, 'B', 'none', $4
             )
             on conflict (score_sheet_id, caption_order) do update
             set caption_name = excluded.caption_name,
                 rating = excluded.rating,
                 modifier = excluded.modifier,
                 comment = excluded.comment`,
            [
              assignment.scoreSheetId,
              order,
              `${assignment.label} Caption ${order}`,
              `${assignment.label} comment ${order}`,
            ]
          );
        }

        await client.query(
          `update public.score_sheets
           set status = 'submitted', submitted_at = timezone('utc', now())
           where id = $1`,
          [assignment.scoreSheetId]
        );

        await client.query(
          `insert into public.canonical_tapes (score_sheet_id, storage_path, duration_seconds, is_stitched)
           values ($1, $2, 120, false)
           on conflict (score_sheet_id) do update
           set storage_path = excluded.storage_path,
               duration_seconds = excluded.duration_seconds,
               is_stitched = excluded.is_stitched`,
          [assignment.scoreSheetId, `smoke/${assignment.scoreSheetId}.m4a`]
        );
      });
    }

    await expectFailure(
      async () => {
        const packetId = await awaitPacketId(adminClient);
        return runAsAuth(baseConfig, IDS.chair, (client) =>
          client.query(`select (public.release_packet($1)).id`, [packetId])
        );
      },
      'Packet must be complete before release'
    );

    for (const assignment of assignments) {
      await runAsAuth(baseConfig, IDS.chair, async (client) => {
        await client.query(
          `update public.score_sheets
           set status = 'verified',
               verified_at = timezone('utc', now()),
               verified_by = $2
           where id = $1`,
          [assignment.scoreSheetId, IDS.chair]
        );
      });
    }

    const packetBeforeRelease = await adminClient.query(
      `select assembly_status, overall_rating, release_status
       from public.packets
       where event_entry_id = $1`,
      [IDS.eventEntry]
    );

    const before = packetBeforeRelease.rows[0];
    if (before.assembly_status !== 'complete' || before.overall_rating !== 'II' || before.release_status !== 'unreleased') {
      throw new Error(`Unexpected packet state before release: ${JSON.stringify(before)}`);
    }

    const releaseResult = await runAsAuth(baseConfig, IDS.chair, async (client) => {
      const packetId = await awaitPacketId(client);
      const res = await client.query(`select (public.release_packet($1)).*`, [packetId]);
      return res.rows[0];
    });

    if (releaseResult.release_status !== 'released') {
      throw new Error(`Expected released packet, got ${JSON.stringify(releaseResult)}`);
    }

    const directorPostRelease = await runAsAuth(baseConfig, IDS.director, async (client) => {
      const packets = await client.query(`select count(*)::int as count from public.packets`);
      const sheets = await client.query(`select count(*)::int as count from public.score_sheets`);
      const tapes = await client.query(`select count(*)::int as count from public.canonical_tapes`);
      return {
        packets: packets.rows[0].count,
        sheets: sheets.rows[0].count,
        tapes: tapes.rows[0].count,
      };
    });

    if (directorPostRelease.packets !== 1 || directorPostRelease.sheets !== 4 || directorPostRelease.tapes !== 4) {
      throw new Error(`Director post-release visibility failed: ${JSON.stringify(directorPostRelease)}`);
    }

    const outsiderVisibility = await runAsAuth(baseConfig, IDS.outsider, async (client) => {
      const packets = await client.query(`select count(*)::int as count from public.packets`);
      return packets.rows[0].count;
    });

    if (outsiderVisibility !== 1) {
      throw new Error(`Authenticated outsider should see only released packets summary; got ${outsiderVisibility}`);
    }

    console.log('Smoke workflow passed.');
    console.log(JSON.stringify({
      grade: gradeCheck.rows[0].grade,
      packetBeforeRelease: before,
      releaseStatus: releaseResult.release_status,
      directorPostRelease,
    }, null, 2));
  } finally {
    await adminClient.end();
  }
}

async function awaitPacketId(client) {
  const res = await client.query(
    `select id from public.packets where event_entry_id = $1`,
    [IDS.eventEntry]
  );
  if (!res.rows[0]?.id) {
    throw new Error('Smoke packet not found');
  }
  return res.rows[0].id;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
