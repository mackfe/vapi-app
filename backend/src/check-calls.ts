import { DbManager } from './database/DbManager.js';

async function listCalls() {
  const db = new DbManager();
  await db.init();
  
  console.log('\n--- CONTENIDO DE LA BASE DE DATOS (TABLA CALLS) ---');
  const calls = await db.getCalls();
  
  if (calls.length === 0) {
    console.log('No se encontraron llamadas en la base de datos.');
  } else {
    console.table(calls.map(c => ({
      ID: c.id,
      Caller: c.caller_id,
      Start: c.started_at,
      End: c.ended_at,
      Status: c.status
    })));
  }
  
  process.exit(0);
}

listCalls().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
