const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:5432/my_ai_companion_local' });
  await c.connect();

  const taskResult = await c.query(
    "select id,status,prompt,plan->'audit' as audit,created_at from agent_tasks where prompt like 'live5604 codeworker verify:%' order by created_at desc limit 1"
  );
  const task = taskResult.rows[0] ?? null;
  console.log('TASK', JSON.stringify(task, null, 2));

  if (task) {
    const callResult = await c.query(
      'select tool_name,status,args_redacted,output_summary from agent_tool_calls where task_id=$1 order by created_at asc',
      [task.id],
    );
    console.log('TOOL_CALLS', JSON.stringify(callResult.rows, null, 2));

    const artResult = await c.query(
      "select title,metadata->'generation' as generation,metadata->'qa' as qa from agent_artifacts where task_id=$1",
      [task.id],
    );
    console.log('ARTIFACT', JSON.stringify(artResult.rows, null, 2));
  }

  await c.end();
})();
