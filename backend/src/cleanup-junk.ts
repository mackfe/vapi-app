import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function cleanJunkCalls() {
  try {
    console.log('--- Iniciando limpieza de registros basura ---');
    
    // Primero borramos las transcripciones asociadas a esas llamadas
    const deleteTranscriptsQuery = `
      DELETE FROM transcripts 
      WHERE call_id IN (
        SELECT id FROM calls 
        WHERE caller_id LIKE '%8888%' 
           OR caller_id LIKE '%9999%'
           OR caller_id = '100' 
           OR caller_id = 'admin'
           OR caller_id = 'asterisk'
           OR LENGTH(caller_id) < 7
      )
    `;
    const resTrans = await pool.query(deleteTranscriptsQuery);
    console.log(`✅ Transcripciones basura eliminadas: ${resTrans.rowCount}`);

    // Luego borramos las llamadas
    const deleteCallsQuery = `
      DELETE FROM calls 
      WHERE caller_id LIKE '%8888%' 
         OR caller_id LIKE '%9999%'
         OR caller_id = '100' 
         OR caller_id = 'admin'
         OR caller_id = 'asterisk'
         OR LENGTH(caller_id) < 7
    `;
    const resCalls = await pool.query(deleteCallsQuery);
    console.log(`✅ Llamadas basura eliminadas: ${resCalls.rowCount}`);

    console.log('--- Limpieza completada con éxito ---');
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
  } finally {
    await pool.end();
  }
}

cleanJunkCalls();
