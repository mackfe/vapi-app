import React, { useState, useEffect } from 'react';
import { Phone, Mic, Activity, History, Settings, X, Calendar, Clock, ChevronRight } from 'lucide-react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = import.meta.env.VITE_API_URL || 'https://3fbk-cm.deepgaze.xyz';
const socket = io(API_URL, {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
});

interface Call {
  id: string;
  caller_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  cost: number;
}

interface Transcript {
  id: number;
  call_id: string;
  role: 'user' | 'ai';
  content: string;
  created_at: string;
}

interface LogEntry {
  msg: string;
  type: 'error' | 'info' | 'success';
  time: string;
}

function App() {
  const [isCalling, setIsCalling] = useState(false);
  const [callerId, setCallerId] = useState('Desconocido');
  const [transcription, setTranscription] = useState<string[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showCallAlert, setShowCallAlert] = useState(false);
  
  // Estados de UI
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'settings'>('dashboard');
  const [sipStatus, setSipStatus] = useState<'registered' | 'error' | 'connecting'>('connecting');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCall, setActiveCall] = useState<string | null>(null);

  // Base de datos real
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [selectedTranscripts, setSelectedTranscripts] = useState<Transcript[]>([]);
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>(() => {
    const saved = localStorage.getItem('sip_logs');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [audioCtx] = useState(() => new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 8000 }));

  useEffect(() => {
    fetchCalls();
    const interval = setInterval(fetchCalls, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem('sip_logs', JSON.stringify(logs.slice(-50)));
  }, [logs]);

  const fetchCalls = async () => {
    try {
      const response = await fetch(`${API_URL}/api/calls`);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Error de servidor');
      }
      const data = await response.json();
      setCalls(data);
    } catch (error: any) {
      if (calls.length === 0) {
        addLog(`Historial: ${error.message || 'Sin conexión'}`, 'error');
      }
    }
  };

  const fetchTranscripts = async (callId: string) => {
    setIsLoadingTranscripts(true);
    try {
      const response = await fetch(`${API_URL}/api/calls/${callId}/transcripts`);
      const data = await response.json();
      setSelectedTranscripts(data);
    } catch (error) {
      addLog('No se pudo obtener el detalle de la llamada', 'error');
    } finally {
      setIsLoadingTranscripts(false);
    }
  };

  useEffect(() => {
    socket.on('connect', () => {
      setSipStatus('registered');
      addLog('Conectado al servidor de monitoreo', 'success');
    });

    socket.on('disconnect', () => {
      setSipStatus('error');
      addLog('Desconectado del servidor', 'error');
    });

    socket.on('connect_error', () => {
      setSipStatus('error');
    });

    socket.on('transcription', (text) => {
      setTranscription((prev) => [...prev, text]);
    });

    socket.on('call-started', (data) => {
      setIsCalling(true);
      setShowCallAlert(true);
      setActiveCall(data.callerId || 'Anónimo');
      setCallerId(data.callerId || 'Anónimo');
      addLog(`Llamada entrante de ${data.callerId}`, 'success');
      fetchCalls();
    });

    socket.on('call-ended', () => {
      setIsCalling(false);
      setShowCallAlert(false);
      setActiveCall(null);
      addLog('Llamada finalizada', 'info');
      fetchCalls();
    });

    socket.on('sip-error', (data) => {
      addLog(`Servicio SIP: ${data.message}`, 'error');
    });

    socket.on('audio-chunk', (chunk: ArrayBuffer) => {
      if (isMonitoring) {
        playPcmChunk(chunk);
      }
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('transcription');
      socket.off('call-started');
      socket.off('call-ended');
      socket.off('sip-error');
      socket.off('audio-chunk');
    };
  }, [isMonitoring, callerId]);

  const addLog = (msg: string, type: 'error' | 'info' | 'success') => {
    setLogs(prev => {
      if (prev.length > 0 && prev[0].msg === msg) return prev;
      return [{ msg, type, time: new Date().toLocaleTimeString() }, ...prev];
    });
  };

  const stats = React.useMemo(() => {
    const totalCalls = calls.length;
    const totalCost = calls.reduce((acc, c) => acc + Number(c.cost || 0), 0);
    const totalSeconds = calls.reduce((acc, c) => {
      if (!c.ended_at) return acc;
      return acc + (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 1000;
    }, 0);
    const totalMinutes = (totalSeconds / 60).toFixed(1);
    return { totalCalls, totalCost, totalMinutes };
  }, [calls]);

  const playPcmChunk = (chunk: ArrayBuffer) => {
    const int16Array = new Int16Array(chunk);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    const buffer = audioCtx.createBuffer(1, float32Array.length, 8000);
    buffer.getChannelData(0).set(float32Array);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const calculateDuration = (start: string, end: string | null) => {
    if (!end) return 'En curso...';
    const s = new Date(start);
    const e = new Date(end);
    const diff = Math.floor((e.getTime() - s.getTime()) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-[#0b0d11] text-white font-sans flex overflow-hidden selection:bg-emerald-500/30">
      <aside className="w-20 lg:w-64 bg-[#111419] border-r border-white/5 flex flex-col p-4 z-50">
        <div className="flex items-center gap-3 px-4 py-8 mb-4">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Activity size={22} className="text-white" />
          </div>
          <div className="hidden lg:block">
            <h1 className="font-black text-lg tracking-tight leading-tight">Municipio 3F</h1>
            <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">Control AI</p>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <NavItem 
            icon={<Activity size={20} />} 
            label="Panel Principal" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <NavItem 
            icon={<History size={20} />} 
            label="Llamadas" 
            active={activeTab === 'history'} 
            onClick={() => setActiveTab('history')} 
          />
          <NavItem 
            icon={<Settings size={20} />} 
            label="Configuración" 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>

        <div className="mt-auto space-y-4">
          <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
            <p className="text-[10px] text-white/30 uppercase font-bold mb-3 tracking-widest">Monitor de Audio</p>
            <button 
              onClick={() => {
                if (audioCtx.state === 'suspended') audioCtx.resume();
                setIsMonitoring(!isMonitoring);
              }}
              className={`w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                isMonitoring 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/20' 
                  : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:scale-[1.02]'
              }`}
            >
              {isMonitoring ? 'Detener Escucha' : 'Escuchar Llamada'}
            </button>
          </div>

          <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
            <p className="text-[10px] text-white/30 uppercase font-bold mb-3 tracking-widest">Estado SIP</p>
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full animate-pulse ${
                sipStatus === 'registered' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'
              }`} />
              <span className="text-xs font-bold text-white/80">
                {sipStatus === 'registered' ? 'Sistema Activo' : 'Error de Conexión'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 relative overflow-y-auto bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.05),_transparent_40%)] custom-scrollbar">
        <header className="p-8 pb-0">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-3xl font-black tracking-tight mb-1">
                {activeTab === 'dashboard' ? 'Centro de Control' : 
                 activeTab === 'history' ? 'Historial de Llamadas' : 'Configuración'}
              </h2>
            </div>
            <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-full border border-emerald-500/20 text-xs font-bold">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
              {sipStatus === 'registered' ? 'Sincronizado' : 'Reconectando...'}
            </div>
          </div>
        </header>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' ? (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid grid-cols-1 xl:grid-cols-3 gap-8"
              >
                <div className="xl:col-span-2 space-y-8">
                  <section className="bg-[#16191e] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
                    <div className="p-6 bg-white/5 flex items-center justify-between border-b border-white/5">
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${isCalling ? 'bg-red-500/20 text-red-500' : 'bg-white/5 text-white/40'}`}>
                          <Phone size={24} className={isCalling ? 'animate-pulse' : ''} />
                        </div>
                        <div>
                          <h3 className="font-bold text-lg">{isCalling ? 'Llamada Activa' : 'Esperando consultas...'}</h3>
                          <p className="text-xs text-white/30 font-medium">
                            {isCalling ? `Conectado con: ${callerId}` : 'IA operando con Base Municipal'}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-8 min-h-[400px] flex flex-col items-center justify-center relative">
                      {!isCalling ? (
                        <div className="text-center group cursor-default">
                          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 group-hover:bg-white/10 transition-colors">
                            <Mic size={32} className="text-white/10 group-hover:text-white/20" />
                          </div>
                          <p className="text-white/20 font-medium max-w-[200px]">Las transcripciones aparecerán aquí en tiempo real</p>
                        </div>
                      ) : (
                        <div className="w-full space-y-4">
                          {transcription.map((line, idx) => (
                            <motion.div 
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              key={idx} 
                              className="bg-white/5 p-4 rounded-2xl border border-white/5 text-sm leading-relaxed"
                            >
                              {line}
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/40 px-2">
                      <Activity size={14} className="text-emerald-500" />
                      Registro de Eventos
                    </h3>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      <AnimatePresence initial={false}>
                        {logs.map((log, idx) => (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            key={idx}
                            className={`flex items-center justify-between p-4 rounded-2xl border text-sm transition-all ${
                              log.type === 'error' ? 'bg-red-500/10 border-red-500/10 text-red-400' :
                              log.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/10 text-emerald-400' :
                              'bg-white/5 border-white/5 text-white/60'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                log.type === 'error' ? 'bg-red-400' :
                                log.type === 'success' ? 'bg-emerald-400' : 'bg-white/30'
                              }`} />
                              <span className="font-medium">{log.msg}</span>
                            </div>
                            <span className="text-[10px] font-bold opacity-30">{log.time}</span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                </div>

                <div className="space-y-6">
                   <section className="bg-[#16191e] rounded-[32px] border border-white/5 overflow-hidden flex flex-col h-[700px] shadow-2xl">
                      <div className="p-6 bg-white/5 border-b border-white/5 flex items-center justify-between">
                        <h3 className="flex items-center gap-3 font-bold">
                          <History size={18} className="text-emerald-500" />
                          Historial Reciente
                        </h3>
                        <button onClick={fetchCalls} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40">
                          <Activity size={14} />
                        </button>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {calls.length === 0 ? (
                          <div className="py-20 text-center text-white/20 italic">Cargando base de datos...</div>
                        ) : (
                          <>
                            {calls.slice(0, 8).map((call) => (
                              <motion.div 
                                key={call.id}
                                whileHover={{ scale: 1.02 }}
                                onClick={() => {
                                  setSelectedCall(call);
                                  fetchTranscripts(call.id);
                                }}
                                className="group p-4 bg-white/[0.02] hover:bg-white/5 rounded-[24px] border border-white/5 cursor-pointer transition-all"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-black text-white/90">{call.caller_id}</span>
                                  <span className="text-[9px] font-bold text-white/20 uppercase">{calculateDuration(call.started_at, call.ended_at)}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-white/30 font-bold uppercase">
                                  <span>{formatDateTime(call.started_at)}</span>
                                  {call.cost > 0 && <span className="text-emerald-500">${Number(call.cost).toFixed(4)}</span>}
                                </div>
                              </motion.div>
                            ))}
                            <button 
                              onClick={() => setActiveTab('history')}
                              className="w-full py-4 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500 hover:bg-emerald-500/5 rounded-2xl transition-all"
                            >
                              Ver todo el historial
                            </button>
                          </>
                        )}
                      </div>
                   </section>
                </div>
              </motion.div>
            ) : activeTab === 'history' ? (
              <motion.div 
                key="history" 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -10 }} 
                className="space-y-6"
              >
                {/* Panel de Métricas */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-[#16191e] p-6 rounded-[24px] border border-white/5 shadow-xl">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Total Llamadas</p>
                    <div className="flex items-end gap-3">
                      <p className="text-3xl font-black text-white">{stats.totalCalls}</p>
                      <span className="text-emerald-500 text-xs font-bold mb-1">↑ Activo</span>
                    </div>
                  </div>
                  <div className="bg-[#16191e] p-6 rounded-[24px] border border-white/5 shadow-xl">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Minutos Totales</p>
                    <div className="flex items-end gap-3">
                      <p className="text-3xl font-black text-white">{stats.totalMinutes}</p>
                      <span className="text-white/20 text-xs font-bold mb-1">min</span>
                    </div>
                  </div>
                  <div className="bg-[#16191e] p-6 rounded-[24px] border border-white/5 shadow-xl">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Costo Acumulado</p>
                    <div className="flex items-end gap-3">
                      <p className="text-3xl font-black text-emerald-500">${stats.totalCost.toFixed(3)}</p>
                      <span className="text-white/20 text-xs font-bold mb-1">USD</span>
                    </div>
                  </div>
                </div>

                {/* Tabla de Historial */}
                <div className="bg-[#16191e] rounded-[32px] border border-white/5 p-8 shadow-2xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div className="relative flex-1 max-w-md">
                      <input 
                        type="text" 
                        placeholder="Buscar por número o ID..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-all pl-12"
                      />
                      <Activity size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
                    </div>
                    <button onClick={fetchCalls} className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-4 rounded-2xl font-black text-sm transition-all shadow-lg shadow-emerald-500/20">
                      REFRESCAR LISTA
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-separate border-spacing-y-3">
                      <thead>
                        <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">
                          <th className="px-6 pb-2">Vecino / ID</th>
                          <th className="px-6 pb-2">Fecha y Hora</th>
                          <th className="px-6 pb-2">Duración</th>
                          <th className="px-6 pb-2">Costo</th>
                          <th className="px-6 pb-2 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calls
                          .filter(c => c.caller_id.toLowerCase().includes(searchTerm.toLowerCase()) || c.id.toLowerCase().includes(searchTerm.toLowerCase()))
                          .map((call) => (
                          <tr 
                            key={call.id} 
                            onClick={() => { setSelectedCall(call); fetchTranscripts(call.id); }}
                            className="group bg-white/[0.02] hover:bg-white/5 transition-all cursor-pointer"
                          >
                            <td className="px-6 py-5 rounded-l-2xl border-y border-l border-white/5">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-emerald-500/20 group-hover:text-emerald-500 transition-all">
                                  <Phone size={18} />
                                </div>
                                <div>
                                  <p className="font-bold text-sm">{call.caller_id}</p>
                                  <p className="text-[10px] font-medium text-white/20 tracking-tighter uppercase">{call.id.slice(0,18)}...</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-5 border-y border-white/5">
                              <p className="text-sm font-medium">{formatDateTime(call.started_at)}</p>
                            </td>
                            <td className="px-6 py-5 border-y border-white/5">
                              <div className="flex items-center gap-2">
                                <Clock size={14} className="text-white/20" />
                                <span className="text-sm font-bold">{calculateDuration(call.started_at, call.ended_at)}</span>
                              </div>
                            </td>
                            <td className="px-6 py-5 border-y border-white/5">
                              <span className="text-sm font-black text-emerald-500">${Number(call.cost).toFixed(4)}</span>
                            </td>
                            <td className="px-6 py-5 rounded-r-2xl border-y border-r border-white/5 text-right">
                              <button className="p-3 bg-white/5 hover:bg-emerald-500 hover:text-white rounded-xl transition-all">
                                <ChevronRight size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {calls.length === 0 && (
                      <div className="py-20 text-center text-white/20 italic">No hay registros para mostrar.</div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-[#16191e] rounded-[32px] border border-white/5 p-12 text-center">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Settings size={40} className="text-white/20" />
                </div>
                <h3 className="text-xl font-bold mb-2">Configuración del Sistema</h3>
                <p className="text-white/40 max-w-sm mx-auto mb-8">Ajustes de API, credenciales SIP y parámetros de la Inteligencia Artificial.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
                  <div className="bg-white/5 p-6 rounded-2xl border border-white/5 text-left">
                    <p className="text-[10px] font-black uppercase text-white/20 mb-2">API Backend</p>
                    <p className="text-sm font-mono break-all">{API_URL}</p>
                  </div>
                  <div className="bg-white/5 p-6 rounded-2xl border border-white/5 text-left">
                    <p className="text-[10px] font-black uppercase text-white/20 mb-2">Transporte Socket</p>
                    <p className="text-sm font-bold">WebSocket + Polling</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>


      {/* Transcript Detail Modal */}
      <AnimatePresence>
        {selectedCall && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCall(null)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#1c2128] w-full max-w-2xl rounded-[40px] border border-white/10 shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/5">
                <div>
                  <h3 className="text-2xl font-black tracking-tight text-emerald-500 mb-1">Detalle de Llamada</h3>
                  <p className="text-xs text-white/40 font-bold uppercase tracking-widest">{selectedCall.caller_id} • {formatDateTime(selectedCall.started_at)}</p>
                </div>
                <button 
                  onClick={() => setSelectedCall(null)}
                  className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-[#0f1115]/30 custom-scrollbar">
                {isLoadingTranscripts ? (
                  <div className="h-64 flex items-center justify-center">
                    <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : selectedTranscripts.length === 0 ? (
                  <div className="text-center py-20">
                    <p className="text-white/20 italic">No se encontraron transcripciones registradas.</p>
                  </div>
                ) : (
                  selectedTranscripts.map((t) => (
                    <div key={t.id} className={`flex flex-col ${t.role === 'user' ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center gap-2 mb-2 px-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${t.role === 'user' ? 'text-emerald-500' : 'text-white/40'}`}>
                          {t.role === 'user' ? 'Vecino' : 'IA Municipio'}
                        </span>
                      </div>
                      <div className={`p-5 rounded-[24px] max-w-[85%] text-sm leading-relaxed shadow-sm ${
                        t.role === 'user' 
                          ? 'bg-emerald-600/20 border border-emerald-500/10 text-white/90 rounded-tl-none' 
                          : 'bg-white/5 border border-white/10 text-white/80 rounded-tr-none'
                      }`}>
                        {t.content}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-8 border-t border-white/5 bg-white/5 flex justify-between items-center">
                <div className="text-xs font-bold text-white/20 uppercase tracking-widest">
                  ID: {selectedCall.id.slice(0,8)}...
                </div>
                <button 
                  onClick={() => setSelectedCall(null)}
                  className="px-8 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl text-sm font-black transition-all shadow-lg shadow-emerald-500/20"
                >
                  VOLVER
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Call Alert */}
      <AnimatePresence>
        {showCallAlert && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[150] bg-emerald-600 p-2 rounded-[32px] shadow-[0_20px_50px_rgba(16,185,129,0.3)] flex items-center gap-6 border border-white/20"
          >
            <div className="bg-white/20 p-4 rounded-[24px] ml-1">
              <Phone size={28} className="animate-bounce" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-black tracking-[0.2em] text-white/60 mb-1">Entrante</p>
              <p className="text-lg font-black text-white">{callerId}</p>
            </div>
            <button 
              onClick={() => {
                if (audioCtx.state === 'suspended') audioCtx.resume();
                setIsMonitoring(true);
                setShowCallAlert(false);
              }}
              className="bg-white text-emerald-600 px-8 py-4 rounded-[24px] font-black text-sm hover:bg-emerald-50 transition-all active:scale-95 mr-1 shadow-lg"
            >
              MONITORIZAR
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`
      flex items-center gap-4 px-4 py-4 rounded-2xl cursor-pointer transition-all duration-300
      ${active ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-white/20 hover:text-white hover:bg-white/5'}
    `}>
      {icon}
      <span className="font-bold text-sm hidden lg:block tracking-tight">{label}</span>
    </div>
  );
}

export default App;
