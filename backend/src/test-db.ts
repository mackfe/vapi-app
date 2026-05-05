import { DbManager } from './database/DbManager.js';
import { v4 as uuidv4 } from 'uuid';

async function testConnection() {
  const db = new DbManager();
  console.log('[Test] Iniciando prueba de conexión...');
  
  await db.init();
  
  const testCallId = uuidv4();
  console.log(`[Test] Creando llamada de prueba ID: ${testCallId}`);
  await db.createCall(testCallId, 'Test-User-123');
  
  console.log('[Test] Guardando transcripción de prueba...');
  await db.saveTranscript(testCallId, 'user', 'Hola, esto es una prueba de base de datos.');
  await db.saveTranscript(testCallId, 'ai', '¡Hola! La base de datos funciona perfectamente.');
  
  console.log('[Test] Finalizando llamada de prueba...');
  await db.endCall(testCallId);
  
  console.log('[Test] ¡Prueba completada exitosamente!');
  process.exit(0);
}

testConnection().catch(err => {
  console.error('[Test] Error en la prueba:', err);
  process.exit(1);
});
