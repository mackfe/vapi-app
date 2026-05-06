import React, { useState, useEffect } from 'react';
import { Phone, Mic, Activity, History, Settings, X, Calendar, Clock, ChevronRight } from 'lucide-react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const socket = io(API_URL);

interface Call {
  id: string;
  caller_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
}

interface Transcript {
  id: number;
  call_id: string;
  role: 'user' | 'ai';
  content: string;
  created_at: string;
}

function App() {
  const [isCalling, setIsCalling] = useState(false);
  const [callerId, setCallerId] = useState('Desconocido');
  const [transcription, setTranscription] = useState<string[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showCallAlert, setShowCallAlert] = useState(false);
  
  // Base de datos real
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [selectedTranscripts, setSelectedTranscripts] = useState<Transcript[]>([]);
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false);

  const [logs, setLogs] = useState<{msg: string, type: 'error' | 'info' | 'success', time: string}[]>(() => {
    const saved = localStorage.getItem('sip_logs');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [audioCtx] = useState(() => new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 8000 }));

  // Cargar historial al inicio
  useEffect(() => {
    fetchCalls();
  }, []);

  useEffect(() => {
    localStorage.setItem('sip_logs', JSON.stringify(logs.slice(-50)));
  }, [logs]);

  const fetchCalls = async () => {
    try {
      const response = await fetch(`${API_URL}/api/calls`);
      const data = await response.json();
      setCalls(data);
    } catch (error) {
      addLog('Error al cargar historial de llamadas', 'error');
    }
  };

  const fetchTranscripts = async (callId: string) => {
    setIsLoadingTranscripts(true);
    try {
      const response = await fetch(`${API_URL}/api/calls/${callId}/transcripts`);
      const data = await response.json();
      setSelectedTranscripts(data);
    } catch (error) {
      addLog('Error al cargar transcripción', 'error');
    } finally {
      setIsLoadingTranscripts(false);
    }
  };

  useEffect(() => {
    socket.on('transcription', (text) => {
      setTranscription((prev) => [...prev, text]);
    });

    socket.on('call-started', (data) => {
      setIsCalling(true);
      setCallerId(data.callerId || 'Anónimo');
      setShowCallAlert(true);
      addLog(`Llamada entrante de ${data.callerId}`, 'success');
      fetchCalls(); // Refrescar lista para ver la llamada en curso
    });

    socket.on('call-ended', () => {
      setIsCalling(false);
      setShowCallAlert(false);
      addLog('Llamada finalizada', 'info');
      setTimeout(fetchCalls, 1000); // Dar tiempo a la DB para cerrar la llamada
    });

    socket.on('sip-error', (data) => {
      addLog(`${data.message} (Status: ${data.status})`, 'error');
    });

    socket.on('audio-chunk', (chunk: ArrayBuffer) => {
      if (isMonitoring) {
        playPcmChunk(chunk);
      }
    });

    return () => {
      socket.off('transcription');
      socket.off('call-started');
      socket.off('call-ended');
      socket.off('sip-error');
      socket.off('audio-chunk');
    };
  }, [isMonitoring, callerId]);

  const addLog = (msg: string, type: 'error' | 'info' | 'success') => {
    setLogs(prev => [{ msg, type, time: new Date().toLocaleTimeString() }, ...prev]);
  };

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

  return (
    <div className="min-h-screen bg-[#0f1115] text-white font-sans flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 bg-[#16191e] border-r border-white/10 flex flex-col p-4">
        <div className="flex items-center gap-3 px-4 py-6">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
            <Activity size={24} />
          </div>
          <span className="text-xl font-bold hidden lg:block tracking-tight text-emerald-500">Municipio 3F</span>
        </div>

        <nav className="flex-1 mt-8 space-y-2">
          <NavItem icon={<Activity />} label="Panel Principal" active />
          <NavItem icon={<History />} label="Llamadas" />
          <NavItem icon={<Settings />} label="Configuración" />
        </nav>

        <div className="p-4 bg-white/5 rounded-2xl mb-4">
          <p className="text-[10px] text-white/40 mb-2 uppercase tracking-widest font-bold">Monitor de Audio</p>
          <button 
            onClick={() => {
              if (audioCtx.state === 'suspended') audioCtx.resume();
              setIsMonitoring(!isMonitoring);
            }}
            className={`w-full py-2 rounded-xl text-xs font-bold transition-all ${isMonitoring ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'bg-white/10 text-white/60'}`}
          >
            {isMonitoring ? 'MONITOREO ACTIVO' : 'ESCUCHAR LLAMADA'}
          </button>
        </div>

        <div className="p-4 bg-white/5 rounded-2xl hidden lg:block">
          <p className="text-xs text-white/40 mb-2 uppercase tracking-widest font-semibold">Estado SIP</p>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${logs.some(l => l.type === 'error') ? 'bg-red-500' : 'bg-green-500'} animate-pulse`} />
            <span className="text-sm font-medium">{logs.some(l => l.type === 'error') ? 'Error de Conexión' : 'Registrado'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col h-screen">
        {/* Header */}
        <header className="h-20 border-b border-white/10 flex items-center justify-between px-8 bg-[#0f1115]/50 backdrop-blur-md sticky top-0 z-10 shrink-0">
          <div>
            <h1 className="text-2xl font-bold">Centro de Control</h1>
            <p className="text-white/40 text-sm">Municipio de 3 de Febrero • Agente VoIP</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-white/5 p-2 rounded-lg border border-white/10">
              <span className="text-sm px-2 py-1 bg-green-500/10 text-green-500 rounded-md font-medium">Activo</span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 p-8 space-y-8 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
            {/* Active Call Section */}
            <div className="lg:col-span-2 space-y-8 h-full flex flex-col">
              <section className="bg-gradient-to-br from-[#1c2128] to-[#16191e] rounded-3xl p-8 border border-white/5 shadow-2xl relative overflow-hidden shrink-0">
                <div className="flex items-center justify-between mb-8 relative z-10">
                   <div className="flex items-center gap-6">
                    <div className={`p-4 rounded-2xl ${isCalling ? 'bg-red-500/20 text-red-500 ring-4 ring-red-500/10 animate-pulse' : 'bg-blue-500/10 text-blue-400'}`}>
                      <Phone size={28} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{isCalling ? `Llamada de: ${callerId}` : 'Esperando consultas...'}</h2>
                      <p className="text-white/40 text-sm">{isCalling ? 'Monitoreo en tiempo real activo' : 'IA operando con Base Municipal'}</p>
                    </div>
                  </div>
                  {isCalling && (
                    <div className="flex gap-2">
                       <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-mono">EN VIVO</span>
                    </div>
                  )}
                </div>

                <div className="h-[400px] bg-black/30 rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
                   <div className="flex-1 space-y-4 overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-white/10">
                    <AnimatePresence>
                      {transcription.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-white/20">
                          <Mic size={48} className="mb-4 opacity-50" />
                          <p>Las transcripciones aparecerán aquí</p>
                        </div>
                      ) : (
                        transcription.map((t, i) => (
                          <motion.div 
                            key={i} 
                            initial={{ opacity: 0, y: 10 }} 
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex ${t.startsWith('Vecino:') ? 'justify-start' : 'justify-end'}`}
                          >
                            <div className={`max-w-[80%] p-4 rounded-2xl ${t.startsWith('Vecino:') ? 'bg-emerald-600/20 border border-emerald-600/20' : 'bg-white/5 border border-white/10'}`}>
                                <p className="text-[10px] uppercase tracking-widest font-bold opacity-40 mb-1">
                                  {t.startsWith('Vecino:') ? 'Vecino' : 'Agente IA'}
                                </p>
                                {t.replace(/^(Vecino:|IA:)/, '').trim()}
                            </div>
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                   </div>
                </div>
              </section>

              {/* Logs Section */}
              <section className="bg-[#16191e] rounded-3xl p-6 border border-white/5 flex-1 overflow-hidden flex flex-col min-h-[250px]">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
                  <Activity size={20} className="text-emerald-500" />
                  Registro de Eventos
                </h3>
                <div className="space-y-2 overflow-y-auto pr-2 flex-1">
                  {logs.map((log, i) => (
                    <div key={i} className={`p-3 rounded-xl flex justify-between items-center text-sm border ${log.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-100' : 'bg-white/5 border-white/5 text-white/80'}`}>
                       <span className="flex items-center gap-2">
                         <div className={`w-1.5 h-1.5 rounded-full ${log.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                         {log.msg}
                       </span>
                       <span className="text-[10px] opacity-40 uppercase">{log.time}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* History Section */}
            <div className="space-y-8 flex flex-col h-full overflow-hidden">
               <section className="bg-[#16191e] rounded-3xl p-6 border border-white/5 flex flex-col h-full">
                 <h3 className="text-lg font-bold mb-6 flex items-center gap-2 shrink-0">
                   <History size={20} className="text-emerald-500" />
                   Historial de la Base de Datos
                 </h3>
                 <div className="space-y-3 overflow-y-auto pr-2 flex-1 scrollbar-hide">
                   {calls.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center opacity-20 italic text-sm">
                       No hay llamadas registradas
                     </div>
                   ) : (
                     calls.map(call => (
                       <motion.div 
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        key={call.id} 
                        onClick={() => {
                          setSelectedCall(call);
                          fetchTranscripts(call.id);
                        }}
                        className="p-4 bg-white/5 rounded-2xl hover:bg-emerald-500/10 transition-all border border-white/5 hover:border-emerald-500/20 group cursor-pointer"
                       >
                          <div className="flex justify-between items-start mb-2">
                            <span className="font-bold text-white/90">{call.caller_id}</span>
                            <ChevronRight size={16} className="text-white/20 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
                          </div>
                          <div className="flex items-center gap-4 text-[10px] text-white/40 uppercase font-bold tracking-widest">
                            <div className="flex items-center gap-1">
                              <Calendar size={10} />
                              {formatDateTime(call.started_at)}
                            </div>
                            <div className={`px-2 py-0.5 rounded ${call.status === 'ongoing' ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/40'}`}>
                              {call.status === 'ongoing' ? 'En Vivo' : 'Finalizada'}
                            </div>
                          </div>
                       </motion.div>
                     ))
                   )}
                 </div>
               </section>
            </div>
          </div>
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
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#1c2128] w-full max-w-2xl rounded-3xl border border-white/10 shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div>
                  <h3 className="text-xl font-bold text-emerald-500">Detalles de la Llamada</h3>
                  <p className="text-sm text-white/40">{selectedCall.caller_id} • {formatDateTime(selectedCall.started_at)}</p>
                </div>
                <button 
                  onClick={() => setSelectedCall(null)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0f1115]/50">
                {isLoadingTranscripts ? (
                  <div className="h-64 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : selectedTranscripts.length === 0 ? (
                  <p className="text-center text-white/20 italic py-20">No hay transcripciones disponibles para esta llamada.</p>
                ) : (
                  selectedTranscripts.map((t) => (
                    <div key={t.id} className={`flex flex-col ${t.role === 'user' ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">
                          {t.role === 'user' ? 'Vecino' : 'IA Municipio'}
                        </span>
                        <span className="text-[10px] opacity-20">
                          {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                      <div className={`p-4 rounded-2xl max-w-[90%] text-sm leading-relaxed ${
                        t.role === 'user' 
                          ? 'bg-emerald-600/20 border border-emerald-600/20 text-white/90 rounded-tl-none' 
                          : 'bg-white/5 border border-white/10 text-white/80 rounded-tr-none'
                      }`}>
                        {t.content}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end">
                <button 
                  onClick={() => setSelectedCall(null)}
                  className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-bold transition-all"
                >
                  Cerrar Historial
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
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[150] bg-emerald-600 p-1 rounded-2xl shadow-2xl flex items-center gap-4 border border-white/20"
          >
            <div className="bg-white/10 p-3 rounded-xl ml-1">
              <Phone size={24} className="animate-bounce" />
            </div>
            <div className="pr-4">
              <p className="text-[10px] uppercase font-bold tracking-widest opacity-70">Nueva Llamada Entrante</p>
              <p className="font-bold">{callerId}</p>
            </div>
            <button 
              onClick={() => {
                if (audioCtx.state === 'suspended') audioCtx.resume();
                setIsMonitoring(true);
                setShowCallAlert(false);
              }}
              className="bg-white text-emerald-600 px-6 py-3 rounded-xl font-bold hover:bg-emerald-50 transition-colors mr-1"
            >
              MONITORIZAR
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <div className={`
      flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200
      ${active ? 'bg-emerald-600 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}
    `}>
      {icon}
      <span className="font-semibold hidden lg:block">{label}</span>
    </div>
  );
}

export default App;
