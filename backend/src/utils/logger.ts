const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

class Logger {
  private level: number;

  constructor() {
    this.level = LEVELS[process.env.LOG_LEVEL as Level] ?? LEVELS.info;
  }

  private fmt(level: Level, msg: string, ctx?: Record<string, unknown>) {
    if (LEVELS[level] < this.level) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...ctx,
    };
    if (level === 'error') {
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      process.stdout.write(JSON.stringify(entry) + '\n');
    }
  }

  debug(msg: string, ctx?: Record<string, unknown>) { this.fmt('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>) { this.fmt('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>) { this.fmt('warn', msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>) { this.fmt('error', msg, ctx); }
}

export const logger = new Logger();
