import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';

dotenv.config();

export class DbManager {
  private pool: pkg.Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT || '5432'),
      ssl: false // Cambiar a true si el servidor requiere SSL
    });
  }

  public async init() {
    try {
      // Tabla de llamadas
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS calls (
          id UUID PRIMARY KEY,
          caller_id VARCHAR(50),
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ended_at TIMESTAMP,
          status VARCHAR(20) DEFAULT 'ongoing'
        );
      `);

      // Tabla de transcripciones
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id SERIAL PRIMARY KEY,
          call_id UUID REFERENCES calls(id),
          role VARCHAR(10), -- 'user' o 'ai'
          content TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log('[DB] Tablas verificadas/creadas correctamente.');
    } catch (error) {
      console.error('[DB] Error al inicializar tablas:', error);
    }
  }

  public async createCall(id: string, callerId: string) {
    try {
      await this.pool.query(
        'INSERT INTO calls (id, caller_id) VALUES ($1, $2)',
        [id, callerId]
      );
      console.log(`[DB] ✅ Llamada registrada exitosamente. ID: ${id}, Caller: ${callerId}`);
    } catch (error) {
      console.error(`[DB] ❌ Error al crear llamada (ID: ${id}):`, error);
    }
  }

  public async endCall(id: string) {
    try {
      await this.pool.query(
        'UPDATE calls SET ended_at = CURRENT_TIMESTAMP, status = $1 WHERE id = $2',
        ['completed', id]
      );
      console.log(`[DB] ✅ Llamada finalizada en DB. ID: ${id}`);
    } catch (error) {
      console.error(`[DB] ❌ Error al finalizar llamada (ID: ${id}):`, error);
    }
  }

  public async saveTranscript(callId: string, role: 'user' | 'ai', content: string) {
    try {
      await this.pool.query(
        'INSERT INTO transcripts (call_id, role, content) VALUES ($1, $2, $3)',
        [callId, role, content]
      );
      console.log(`[DB] 📝 Transcripción guardada (${role}): "${content.substring(0, 30)}..."`);
    } catch (error) {
      console.error(`[DB] ❌ Error al guardar transcripción para ${callId}:`, error);
    }
  }

  public async getCalls() {
    try {
      const result = await this.pool.query(
        'SELECT * FROM calls ORDER BY started_at DESC LIMIT 50'
      );
      return result.rows;
    } catch (error) {
      console.error('[DB] Error al obtener llamadas:', error);
      return [];
    }
  }

  public async getTranscripts(callId: string) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM transcripts WHERE call_id = $1 ORDER BY created_at ASC',
        [callId]
      );
      return result.rows;
    } catch (error) {
      console.error('[DB] Error al obtener transcripciones:', error);
      return [];
    }
  }
}
