const { withTx } = require("./db");

async function loadState(client){
  const { rows } = await client.query("SELECT * FROM game_state WHERE id=1");
  if(rows.length===0) throw new Error("game_state row missing");
  return rows[0];
}

async function loadLog(client, limit=200){
  const { rows } = await client.query(
    "SELECT id, created_at, sectors, animal, count, game_version FROM survey_log ORDER BY id DESC LIMIT $1",
    [limit]
  );
  return rows;
}

async function clearLog(client){
  await client.query("TRUNCATE survey_log RESTART IDENTITY");
}

async function tryDedup(client, commandId){
  const q = "INSERT INTO commands_dedup(command_id) VALUES ($1) ON CONFLICT DO NOTHING";
  const res = await client.query(q, [commandId]);
  return res.rowCount === 1;
}

async function saveState(client, patch){
  const keys = Object.keys(patch);
  if(keys.length===0) return;
  const sets = keys.map((k,i)=> `${k}=$${i+1}`);
  const vals = keys.map(k=>patch[k]);
  vals.push(1);
  const sql = `UPDATE game_state SET ${sets.join(", ")}, updated_at=now() WHERE id=$${vals.length}`;
  await client.query(sql, vals);
}

module.exports = { loadState, loadLog, clearLog, tryDedup, saveState };
