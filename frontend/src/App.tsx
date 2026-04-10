import React, { useState, useEffect } from 'react';
import { Phone, Mic, Activity, History, Settings } from 'lucide-react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const socket = io(API_URL);

function App() {
  const [isCalling, setIsCalling] = useState(false);
  const [callerId, setCallerId] = useState('Desconocido');
  const [transcription, setTranscription] = useState<string[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showCallAlert, setShowCallAlert] = useState(false);
  
  // Persistencia local
  const [logs, setLogs] = useState<{msg: string, type: 'error' | 'info' | 'success', time: string}[]>(() => {
    const saved = localStorage.getItem('sip_logs');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [calls, setCalls] = useState<{id: number, number: string, time: string, duration: string, status: string}[]>(() => {
    const saved = localStorage.getItem('sip_history');
    return saved ? JSON.parse(saved) : [
      { id: 1, number: '+54 11 5246-9291', time: '10:30 AM', duration: '2:15', status: 'Completada' },
    ];
  });

  const [audioCtx] = useState(() => new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 8000 }));

  useEffect(() => {
    localStorage.setItem('sip_logs', JSON.stringify(logs.slice(-50)));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('sip_history', JSON.stringify(calls.slice(-50)));
  }, [calls]);

  useEffect(() => {
    socket.on('transcription', (text) => {
      setTranscription((prev) => [...prev, text]);
    });

    socket.on('call-started', (data) => {
      setIsCalling(true);
      setCallerId(data.callerId || 'Anónimo');
      setShowCallAlert(true);
      addLog(`Llamada entrante de ${data.callerId}`, 'success');
    });

    socket.on('call-ended', () => {
      setIsCalling(false);
      setShowCallAlert(false);
      const newCall = {
        id: Date.now(),
        number: callerId,
        time: new Date().toLocaleTimeString(),
        duration: 'En curso',
        status: 'Completada'
      };
      setCalls(prev => [newCall, ...prev]);
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
      <main className="flex-1 relative flex flex-col">
        {/* Header */}
        <header className="h-20 border-b border-white/10 flex items-center justify-between px-8 bg-[#0f1115]/50 backdrop-blur-md sticky top-0 z-10">
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
        <div className="p-8 space-y-8 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Active Call Section */}
            <div className="lg:col-span-2 space-y-8">
              <section className="bg-gradient-to-br from-[#1c2128] to-[#16191e] rounded-3xl p-8 border border-white/5 shadow-2xl relative overflow-hidden group">
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

                <div className="min-h-[300px] bg-black/30 rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
                   <div className="flex-1 space-y-4 overflow-y-auto max-h-[300px] pr-4 scrollbar-thin scrollbar-thumb-white/10">
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

              {/* Logs & Errors Section */}
              <section className="bg-[#16191e] rounded-3xl p-6 border border-white/5">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Activity size={20} className="text-emerald-500" />
                  Registro de Eventos y Errores
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                  {logs.length === 0 ? (
                    <p className="text-white/20 text-center py-8 italic">No hay eventos registrados</p>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className={`p-3 rounded-xl flex justify-between items-center text-sm border ${log.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-100' : 'bg-white/5 border-white/5 text-white/80'}`}>
                         <span className="flex items-center gap-2">
                           <div className={`w-1.5 h-1.5 rounded-full ${log.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                           {log.msg}
                         </span>
                         <span className="text-[10px] opacity-40 uppercase">{log.time}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            {/* Side Stats/History */}
            <div className="space-y-8">
               <section className="bg-[#16191e] rounded-3xl p-6 border border-white/5">
                 <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                   <History size={20} className="text-emerald-500" />
                   Historial Reciente
                 </h3>
                 <div className="space-y-4">
                   {calls.map(call => (
                     <div key={call.id} className="p-4 bg-white/5 rounded-2xl hover:bg-white/10 transition-colors border border-transparent hover:border-white/10 group cursor-pointer">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium">{call.number}</span>
                          <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded uppercase tracking-tighter opacity-60">{call.duration}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-white/40">
                          <span>{call.time}</span>
                          <span className="text-green-500">{call.status}</span>
                        </div>
                     </div>
                   ))}
                 </div>
               </section>
            </div>
          </div>
        </div>
      </main>

      {/* Floating Call Alert */}
      <AnimatePresence>
        {showCallAlert && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 p-1 rounded-2xl shadow-2xl flex items-center gap-4 border border-white/20"
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
            <button 
              onClick={() => setShowCallAlert(false)}
              className="p-3 text-white/60 hover:text-white"
            >
              Ocultar
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
