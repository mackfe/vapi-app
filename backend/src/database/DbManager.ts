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

      // [NUEVO] Tabla de Blacklist
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS blacklist (
          id SERIAL PRIMARY KEY,
          phone_number VARCHAR(50) UNIQUE NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // [NUEVO] Tabla de Configuración Global
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT
        );
      `);
      await this.pool.query(`
        INSERT INTO system_settings (key, value) VALUES ('security_mode', 'blacklist') ON CONFLICT DO NOTHING;
      `);

      // [NUEVO] Tabla de Agentes (Líneas SIP)
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS agents (
            id SERIAL PRIMARY KEY,
            phone_number VARCHAR(50) UNIQUE NOT NULL,
            name VARCHAR(100) NOT NULL,
            ai_model VARCHAR(50) DEFAULT 'llama-3.3-70b-versatile',
            groq_api_key VARCHAR(255),
            fishaudio_api_key VARCHAR(255),
            voice_reference_id VARCHAR(255),
            sip_domain VARCHAR(100),
            sip_user VARCHAR(50),
            sip_password VARCHAR(100),
            master_prompt TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Tabla para Documentos de RAG
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS agent_documents (
            id SERIAL PRIMARY KEY,
            agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
            filename VARCHAR(255) NOT NULL,
            extracted_content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Migraciones de esquema
      try {
        await this.pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS sip_domain VARCHAR(100);');
        await this.pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS sip_user VARCHAR(50);');
        await this.pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS sip_password VARCHAR(100);');
        await this.pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS master_prompt TEXT;');
        await this.pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS department VARCHAR(255);');
        
        // Fase 4: Telemetría de Costos
        await this.pool.query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS stt_cost DECIMAL(10, 6) DEFAULT 0;');
        await this.pool.query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS llm_cost DECIMAL(10, 6) DEFAULT 0;');
        await this.pool.query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS tts_cost DECIMAL(10, 6) DEFAULT 0;');
        await this.pool.query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS llm_tokens INTEGER DEFAULT 0;');
        await this.pool.query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS tts_chars INTEGER DEFAULT 0;');
        await this.pool.query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS stt_seconds DECIMAL(10, 2) DEFAULT 0;');
      } catch (e) {
        console.log('[DB] Migraciones omitidas (posiblemente ya existen).');
      }


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

  public async endCall(id: string, metrics: { cost: number, sttCost: number, llmCost: number, ttsCost: number, tokens: number, chars: number, seconds: number } = { cost: 0, sttCost: 0, llmCost: 0, ttsCost: 0, tokens: 0, chars: 0, seconds: 0 }) {
    try {
      const result = await this.pool.query(
        `UPDATE calls 
         SET ended_at = CURRENT_TIMESTAMP, 
             status = $1, 
             cost = $2, 
             stt_cost = $3, 
             llm_cost = $4, 
             tts_cost = $5, 
             llm_tokens = $6, 
             tts_chars = $7, 
             stt_seconds = $8
         WHERE id = $9 AND ended_at IS NULL`,
        ['completed', metrics.cost, metrics.sttCost, metrics.llmCost, metrics.ttsCost, metrics.tokens, metrics.chars, metrics.seconds, id]
      );
      console.log(`[DB] ✅ Llamada finalizada en DB. ID: ${id}, Costo Total: $${metrics.cost.toFixed(4)}`);
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

  public async isBlacklisted(callerId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        "SELECT * FROM blacklist WHERE $1 LIKE phone_number || '%'",
        [callerId]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('[DB] Error verificando blacklist:', error);
      return false;
    }
  }

  public async getBlacklist(): Promise<any[]> {
    try {
      const result = await this.pool.query('SELECT * FROM blacklist ORDER BY created_at DESC');
      return result.rows;
    } catch (error) {
      console.error('[DB] Error obteniendo blacklist:', error);
      return [];
    }
  }

  public async addBlacklist(phoneNumber: string, description: string): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO blacklist (phone_number, description) VALUES ($1, $2) ON CONFLICT (phone_number) DO UPDATE SET description = $2',
        [phoneNumber, description]
      );
      console.log(`[DB] ✅ Número agregado al blacklist: ${phoneNumber}`);
    } catch (error) {
      console.error('[DB] Error agregando al blacklist:', error);
      throw error;
    }
  }

  public async removeBlacklist(id: number): Promise<void> {
    try {
      await this.pool.query('DELETE FROM blacklist WHERE id = $1', [id]);
      console.log(`[DB] ✅ Número eliminado del blacklist (ID: ${id})`);
    } catch (error) {
      console.error('[DB] Error eliminando del blacklist:', error);
      throw error;
    }
  }

  // [NUEVO] Métodos para Modo de Seguridad
  public async getSecurityMode(): Promise<string> {
    try {
      const result = await this.pool.query("SELECT value FROM system_settings WHERE key = 'security_mode'");
      return result.rows.length > 0 ? result.rows[0].value : 'blacklist';
    } catch (error) {
      console.error('[DB] Error obteniendo security_mode:', error);
      return 'blacklist';
    }
  }

  public async setSecurityMode(mode: 'blacklist' | 'whitelist'): Promise<void> {
    try {
      await this.pool.query(
        "INSERT INTO system_settings (key, value) VALUES ('security_mode', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [mode]
      );
      console.log(`[DB] ✅ Modo de seguridad cambiado a: ${mode}`);
    } catch (error) {
      console.error('[DB] Error cambiando security_mode:', error);
      throw error;
    }
  }

  public async isAllowedInWhitelist(callerId: string): Promise<boolean> {
    try {
      // Si la lista está vacía, no bloqueamos todo por defecto para evitar aislar el sistema.
      // Opcionalmente, la regla estricta sería bloquear. Vamos a verificar si la lista está vacía primero.
      const listCount = await this.pool.query('SELECT COUNT(*) FROM blacklist');
      if (parseInt(listCount.rows[0].count) === 0) {
        return true; // Si la whitelist está vacía, permitimos (o podríamos retornar false para bloqueo total)
      }

      const result = await this.pool.query(
        "SELECT * FROM blacklist WHERE $1 LIKE phone_number || '%'",
        [callerId]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('[DB] Error verificando whitelist:', error);
      return false; // Ante la duda en modo estricto, bloquear (o permitir según política)
    }
  }

  // --- MÉTODOS CRUD DE AGENTES ---
  
  public async getAgents(): Promise<any[]> {
    try {
      const result = await this.pool.query('SELECT * FROM agents ORDER BY id ASC');
      return result.rows;
    } catch (error) {
      console.error('[DB] Error obteniendo agentes:', error);
      return [];
    }
  }

  public async getAgentByPhone(phoneNumber: string): Promise<any | null> {
    try {
      // Intento 1: Match Exacto
      let result = await this.pool.query('SELECT * FROM agents WHERE phone_number = $1', [phoneNumber]);
      if (result.rows.length > 0) return result.rows[0];

      // Intento 2: Match Parcial (Dainus puede enviar 001... u otro prefijo)
      result = await this.pool.query("SELECT * FROM agents WHERE $1 LIKE '%' || phone_number", [phoneNumber]);
      if (result.rows.length > 0) return result.rows[0];

      // Intento 3: Fallback si solo hay 1 agente registrado en todo el sistema
      const allAgents = await this.pool.query('SELECT * FROM agents');
      if (allAgents.rows.length === 1) {
        return allAgents.rows[0];
      }

      return null;
    } catch (error) {
      console.error('[DB] Error obteniendo agente por número:', error);
      return null;
    }
  }

  public async addAgent(agent: any): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO agents (phone_number, name, department, ai_model, groq_api_key, fishaudio_api_key, voice_reference_id, sip_domain, sip_user, sip_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          agent.phone_number,
          agent.name,
          agent.department || '',
          agent.ai_model || 'llama-3.3-70b-versatile',
          agent.groq_api_key,
          agent.fishaudio_api_key,
          agent.voice_reference_id,
          agent.sip_domain,
          agent.sip_user,
          agent.sip_password
        ]
      );
    } catch (error) {
      console.error('[DB] Error añadiendo agente:', error);
      throw error;
    }
  }

  public async updateAgent(id: number, agent: any): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE agents 
         SET phone_number = $1, name = $2, department = $3, ai_model = $4, groq_api_key = $5, fishaudio_api_key = $6, voice_reference_id = $7, sip_domain = $8, sip_user = $9, sip_password = $10
         WHERE id = $11`,
        [
          agent.phone_number,
          agent.name,
          agent.department || '',
          agent.ai_model,
          agent.groq_api_key,
          agent.fishaudio_api_key,
          agent.voice_reference_id,
          agent.sip_domain,
          agent.sip_user,
          agent.sip_password,
          id
        ]
      );
    } catch (error) {
      console.error(`[DB] Error actualizando agente ${id}:`, error);
      throw error;
    }
  }

  public async deleteAgent(id: number): Promise<void> {
    try {
      await this.pool.query('DELETE FROM agents WHERE id = $1', [id]);
    } catch (error) {
      console.error(`[DB] Error eliminando agente ${id}:`, error);
      throw error;
    }
  }

  public async updateAgentMasterPrompt(id: number, prompt: string): Promise<void> {
    try {
      await this.pool.query('UPDATE agents SET master_prompt = $1 WHERE id = $2', [prompt, id]);
    } catch (error) {
      console.error(`[DB] Error actualizando master prompt para agente ${id}:`, error);
      throw error;
    }
  }

  public async addAgentDocument(agentId: number, filename: string, content: string): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO agent_documents (agent_id, filename, extracted_content) VALUES ($1, $2, $3)',
        [agentId, filename, content]
      );
    } catch (error) {
      console.error(`[DB] Error añadiendo documento para agente ${agentId}:`, error);
      throw error;
    }
  }

  public async getAgentDocuments(agentId: number): Promise<any[]> {
    try {
      const result = await this.pool.query('SELECT * FROM agent_documents WHERE agent_id = $1 ORDER BY created_at DESC', [agentId]);
      return result.rows;
    } catch (error) {
      console.error(`[DB] Error obteniendo documentos para agente ${agentId}:`, error);
      return [];
    }
  }
}
