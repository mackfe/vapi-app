import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export class DbManager {
  private pool: pkg.Pool;

  constructor() {
    // Si por alguna razón no están cargadas, forzamos la carga desde el archivo
    if (!process.env.DB_HOST) {
      dotenv.config({ path: path.resolve(process.cwd(), '.env') });
    }

    const host = process.env.DB_HOST;
    const user = process.env.DB_USER;
    
    console.log(`[DB] Directorio de trabajo: ${process.cwd()}`);
    console.log(`[DB] Configurando conexión hacia: ${host || 'UNDEFINED'} (User: ${user || 'undefined'})`);

    this.pool = new Pool({
      host: host,
      user: user,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT || '5432'),
      ssl: false 
    });
  }

  public async init() {
    try {
      console.log(`[DB] Inicializando tablas en ${process.env.DB_HOST}...`);
      // Tabla de llamadas
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS calls (
          id UUID PRIMARY KEY,
          caller_id VARCHAR(50),
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ended_at TIMESTAMP,
          status VARCHAR(20) DEFAULT 'ongoing',
          cost DECIMAL(10, 6) DEFAULT 0
        );
      `);

      // Asegurar que la columna cost existe (para migraciones)
      await this.pool.query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS cost DECIMAL(10, 6) DEFAULT 0;');

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

      // [NUEVO] Tabla de Tickets AI
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS tickets (
          id SERIAL PRIMARY KEY,
          call_id UUID REFERENCES calls(id),
          subject VARCHAR(255),
          summary TEXT,
          priority VARCHAR(20), -- 'low', 'medium', 'high', 'urgent'
          status VARCHAR(20) DEFAULT 'open',
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

  public async endCall(id: string, cost: number = 0) {
    try {
      const result = await this.pool.query(
        'UPDATE calls SET ended_at = CURRENT_TIMESTAMP, status = $1, cost = $2 WHERE id = $3 AND ended_at IS NULL',
        ['completed', cost, id]
      );
      console.log(`[DB] ✅ Llamada finalizada en DB. ID: ${id}, Costo Total: $${cost.toFixed(4)}`);
    } catch (error) {
      console.error(`[DB] ❌ Error al finalizar llamada (ID: ${id}):`, error);
    }
  }

  /**
   * Cierra llamadas que quedaron abiertas (más de 30 minutos) por fallos de red o reinicios.
   * Se les asigna una duración fija de 5 minutos para no ensuciar las métricas con horas falsas.
   */
  public async cleanupAbandonedCalls() {
    try {
      await this.pool.query(`
        UPDATE calls 
        SET ended_at = started_at + INTERVAL '5 minutes', 
            status = 'abandoned' 
        WHERE ended_at IS NULL 
        AND started_at < NOW() - INTERVAL '30 minutes'
      `);
      console.log('[DB] ✅ Llamadas abandonadas limpiadas (con duración normalizada).');
    } catch (error) {
      console.error('[DB] ❌ Error al limpiar llamadas abandonadas:', error);
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
      const result = await this.pool.query(`
        SELECT * FROM calls 
        WHERE LENGTH(caller_id) >= 7 
        AND caller_id NOT LIKE '%8888%'
        AND caller_id NOT LIKE '100%'
        AND caller_id NOT IN ('admin', 'asterisk', 'sipvicious')
        ORDER BY started_at DESC 
        LIMIT 100
      `);
      return result.rows;
    } catch (error) {
      console.error('[DB] Error al obtener llamadas:', error);
      return [];
    }
  }

  public async getStats() {
    try {
      const filter = `
        WHERE LENGTH(caller_id) >= 7 
        AND caller_id NOT LIKE '%8888%' 
        AND caller_id NOT LIKE '100%'
        AND caller_id NOT IN ('admin', 'asterisk', 'sipvicious')
      `;

      const totalCalls = await this.pool.query(`SELECT COUNT(*) FROM calls ${filter}`);
      const answeredCalls = await this.pool.query(`
        SELECT COUNT(DISTINCT c.id) 
        FROM transcripts t
        JOIN calls c ON t.call_id = c.id
        ${filter}
      `);
      const byDay = await this.pool.query(`
        SELECT TO_CHAR(started_at, 'YYYY-MM-DD') as day, COUNT(*) as count 
        FROM calls 
        ${filter}
        GROUP BY day 
        ORDER BY day DESC 
        LIMIT 7
      `);
      
      const avgDuration = await this.pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) as avg_secs 
        FROM calls 
        ${filter} AND ended_at IS NOT NULL
      `);

      // [NUEVO] Métricas Financieras
      const financialStats = await this.pool.query(`
        SELECT 
          SUM(EXTRACT(EPOCH FROM (ended_at - started_at))) / 60 as total_mins,
          SUM(cost) as total_cost,
          AVG(CASE WHEN EXTRACT(EPOCH FROM (ended_at - started_at)) > 0 
              THEN cost / (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60) 
              ELSE 0 END) as avg_cost_min
        FROM calls 
        ${filter} AND ended_at IS NOT NULL
      `);

      const spendingByDay = await this.pool.query(`
        SELECT TO_CHAR(started_at, 'YYYY-MM-DD') as day, SUM(cost)::float as spending
        FROM calls 
        ${filter}
        GROUP BY day 
        ORDER BY day DESC 
        LIMIT 7
      `);

      // [NUEVO] Estadísticas de Tickets
      const ticketStats = await this.pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE priority = 'urgent') as urgent,
          COUNT(*) FILTER (WHERE priority = 'high') as high,
          COUNT(*) FILTER (WHERE priority = 'medium') as medium,
          COUNT(*) FILTER (WHERE priority = 'low') as low
        FROM tickets
      `);

      const ticketsByDay = await this.pool.query(`
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as day, COUNT(*) as count
        FROM tickets
        GROUP BY day 
        ORDER BY day DESC 
        LIMIT 7
      `);
      
      return {
        total: parseInt(totalCalls.rows[0].count),
        answered: parseInt(answeredCalls.rows[0].count),
        avgDurationMins: (parseFloat(avgDuration.rows[0].avg_secs || 0) / 60).toFixed(1),
        totalMins: parseFloat(financialStats.rows[0].total_mins || 0).toFixed(1),
        totalCost: parseFloat(financialStats.rows[0].total_cost || 0).toFixed(4),
        avgCostMin: parseFloat(financialStats.rows[0].avg_cost_min || 0).toFixed(4),
        byDay: byDay.rows.reverse(),
        spendingByDay: spendingByDay.rows.reverse(),
        ticketStats: ticketStats.rows[0],
        ticketsByDay: ticketsByDay.rows.reverse()
      };
    } catch (error) {
      console.error('[DB] Error al obtener estadísticas:', error);
      throw error;
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

  // [NUEVO] Métodos para Tickets
  public async createTicket(callId: string, subject: string, summary: string, priority: string) {
    try {
      await this.pool.query(
        "INSERT INTO tickets (call_id, subject, summary, priority, status) VALUES ($1, $2, $3, $4, 'pending')",
        [callId, subject, summary, priority]
      );
      console.log(`[DB] ✅ Ticket creado para la llamada: ${callId}`);
    } catch (error) {
      console.error('[DB] ❌ Error al crear ticket:', error);
    }
  }

  public async getTickets() {
    try {
      const result = await this.pool.query(`
        SELECT t.*, c.caller_id 
        FROM tickets t 
        JOIN calls c ON t.call_id = c.id 
        ORDER BY t.created_at DESC
      `);
      return result.rows;
    } catch (error) {
      console.error('[DB] Error al obtener tickets:', error);
      return [];
    }
  }

  public async updateTicketStatus(id: number, status: string) {
    try {
      await this.pool.query('UPDATE tickets SET status = $1 WHERE id = $2', [status, id]);
    } catch (error) {
      console.error('[DB] Error al actualizar ticket:', error);
    }
  }
}
