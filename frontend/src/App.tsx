import React, { useState, useEffect } from 'react';
import { 
  Phone, 
  BarChart3, 
  Settings, 
  History, 
  Search, 
  Clock, 
  User, 
  ChevronRight, 
  X, 
  ArrowUpRight, 
  CheckCircle2,
  TrendingUp,
  Download,
  Activity,
  Menu
} from 'lucide-react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const socket = io(API_URL, {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// PwC Colors
const COLORS = {
  primary: '#e04f39', // Orange
  secondary: '#ffb600', // Yellow
  dark: '#2d2d2d',
  light: '#f3f4f6',
  white: '#ffffff',
  textMuted: '#6b7280'
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [calls, setCalls] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ 
    total: 0, 
    answered: 0, 
    byDay: [], 
    spendingByDay: [],
    avgDurationMins: 0,
    totalMins: 0,
    totalCost: 0,
    avgCostMin: 0
  });
  const [sipStatus, setSipStatus] = useState('connecting');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const [selectedTranscripts, setSelectedTranscripts] = useState<any[]>([]);
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false);
  const [showCallAlert, setShowCallAlert] = useState(false);
  const [callerId, setCallerId] = useState('');

  useEffect(() => {
    fetchCalls();
    fetchStats();
    fetchTickets();

    socket.on('connect', () => {
      setSipStatus('registered');
    });

    socket.on('connect_error', () => {
      setSipStatus('error');
    });

    socket.on('call-started', (data) => {
      setCallerId(data.callerId);
      setShowCallAlert(true);
      fetchCalls();
    });

    socket.on('call-ended', () => {
      setShowCallAlert(false);
      fetchCalls();
      fetchStats();
      setTimeout(fetchTickets, 3000);
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('call-started');
      socket.off('call-ended');
    };
  }, []);

  const fetchCalls = async () => {
    try {
      const res = await fetch(`${API_URL}/api/calls`);
      const data = await res.json();
      setCalls(data);
    } catch (e) {
      console.error('Error fetching calls');
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/stats`);
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error('Error fetching stats');
    }
  };

  const fetchTickets = async () => {
    try {
      const res = await fetch(`${API_URL}/api/tickets`);
      const data = await res.json();
      setTickets(data);
    } catch (e) {
      console.error('Error fetching tickets');
    }
  };

  const viewTranscripts = async (call: any) => {
    setSelectedCall(call);
    setIsLoadingTranscripts(true);
    try {
      const res = await fetch(`${API_URL}/api/calls/${call.id}/transcripts`);
      const data = await res.json();
      setSelectedTranscripts(data);
    } catch (e) {
      console.error('Error fetching transcripts');
    } finally {
      setIsLoadingTranscripts(false);
    }
  };

  const filteredCalls = calls.filter(c => 
    c.caller_id.includes(searchTerm) || c.id.includes(searchTerm)
  );

  const filteredTickets = tickets.filter(t => 
    t.subject.toLowerCase().includes(searchTerm.toLowerCase()) || t.caller_id.includes(searchTerm)
  );

  const calculateDuration = (start: string, end: string | null) => {
    if (!end) return 'En curso...';
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const diff = Math.floor((e - s) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}m ${secs}s`;
  };

  const pieData = [
    { name: 'Contestadas', value: stats.answered, color: COLORS.primary },
    { name: 'Sin Respuesta', value: Math.max(0, stats.total - stats.answered), color: COLORS.secondary },
  ];

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-[#2d2d2d] font-sans flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shadow-sm fixed h-full z-20">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-[#e04f39] rounded-lg flex items-center justify-center text-white shadow-lg shadow-orange-100">
              <Phone size={20} strokeWidth={3} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter leading-none">JOBAAJ</h1>
              <p className="text-[10px] font-bold text-[#e04f39] uppercase tracking-widest mt-1">Call Center AI</p>
            </div>
          </div>

          <nav className="space-y-2">
            <NavItem icon={<BarChart3 size={20} />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavItem icon={<History size={20} />} label="Llamadas" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
            <NavItem icon={<CheckCircle2 size={20} />} label="Tickets AI" active={activeTab === 'tickets'} onClick={() => setActiveTab('tickets')} />
            <NavItem icon={<Settings size={20} />} label="Configuración" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-gray-50">
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl">
            <div className={`w-2.5 h-2.5 rounded-full ${sipStatus === 'registered' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Estado SIP</p>
              <p className="text-xs font-black uppercase">{sipStatus === 'registered' ? 'Activo' : 'Error'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 ml-64 p-10 overflow-y-auto">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h2 className="text-3xl font-black tracking-tight">
              {activeTab === 'dashboard' ? 'Centro de Control' : 
               activeTab === 'tickets' ? 'Módulo de Tickets AI' : 
               activeTab === 'history' ? 'Historial de Llamadas' : 'Ajustes'}
            </h2>
            <p className="text-gray-500 font-medium">Gestionando inteligencia operativa en tiempo real.</p>
          </div>
          <div className="flex gap-4">
            <button className="bg-white px-6 py-3 rounded-xl border border-gray-200 text-sm font-bold shadow-sm hover:bg-gray-50 flex items-center gap-2">
              <Download size={18} /> Exportar
            </button>
            <div className="bg-[#e04f39] text-white px-6 py-3 rounded-xl shadow-lg shadow-orange-100 flex items-center gap-3">
              <User size={18} />
              <span className="font-bold text-sm tracking-tight">Administrador</span>
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' ? (
            <motion.div key="dash" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard label="Total Llamadas" value={stats.total} icon={<Phone size={24} className="text-[#e04f39]" />} trend="+12%" />
                <StatCard 
                  label="Contestadas" 
                  value={stats.total > 0 ? ((stats.answered / stats.total) * 100).toFixed(1) : 0} 
                  icon={<CheckCircle2 size={24} className="text-[#ffb600]" />} 
                  trend="Real" 
                  isPercent 
                />
                <StatCard label="Tpo. Promedio" value={`${stats.avgDurationMins}m`} icon={<Clock size={24} className="text-gray-400" />} trend="Real" />
                <StatCard label="Tickets Activos" value={tickets.length} icon={<History size={24} className="text-[#e04f39]" />} trend="Auto" />
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 min-h-[400px] flex flex-col">
                  <h3 className="font-black text-lg mb-6 text-[#2d2d2d]">Estado de Respuesta</h3>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <PieChart>
                        <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          {pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                        </Pie>
                        <Tooltip />
                        <Legend verticalAlign="bottom" height={36}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="lg:col-span-2 bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 min-h-[400px] flex flex-col">
                  <h3 className="font-black text-lg mb-6 text-[#2d2d2d]">Volumen Semanal</h3>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <BarChart data={stats.byDay}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                        <Tooltip cursor={{fill: '#f9fafb'}} />
                        <Bar dataKey="count" fill="#e04f39" radius={[4, 4, 0, 0]} barSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Recent Activity Table */}
              <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-8 border-b border-gray-50 flex justify-between items-center">
                  <h3 className="font-black text-lg">Actividad Reciente</h3>
                  <button onClick={() => setActiveTab('history')} className="text-[#e04f39] font-bold text-sm flex items-center gap-1 hover:gap-2 transition-all">
                    Ver Todo <ChevronRight size={16} />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        <th className="px-8 py-4">Llamante</th>
                        <th className="px-8 py-4">Fecha</th>
                        <th className="px-8 py-4">Duración</th>
                        <th className="px-8 py-4 text-right">Costo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {calls.slice(0, 5).map(call => (
                        <tr key={call.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-8 py-5 font-bold">{call.caller_id}</td>
                          <td className="px-8 py-5 text-sm text-gray-500">{new Date(call.started_at).toLocaleString()}</td>
                          <td className="px-8 py-5 text-sm font-medium">{calculateDuration(call.started_at, call.ended_at)}</td>
                          <td className="px-8 py-5 text-right font-black text-[#e04f39]">${Number(call.cost).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          ) : activeTab === 'tickets' ? (
            <motion.div key="tickets" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <div className="flex gap-4 mb-8">
                <div className="flex-1 relative">
                  <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input 
                    type="text" 
                    placeholder="Buscar por asunto o número..." 
                    className="w-full pl-16 pr-6 py-5 bg-white rounded-3xl border-none shadow-sm focus:ring-2 focus:ring-orange-500 font-medium transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button onClick={fetchTickets} className="bg-[#e04f39] text-white px-10 rounded-2xl font-black text-sm shadow-lg shadow-orange-100">
                  ACTUALIZAR
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredTickets.map(ticket => (
                  <div key={ticket.id} className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col group">
                    <div className="flex justify-between items-start mb-6">
                      <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        ticket.priority === 'urgent' ? 'bg-red-100 text-red-600' :
                        ticket.priority === 'high' ? 'bg-orange-100 text-orange-600' :
                        ticket.priority === 'medium' ? 'bg-yellow-100 text-yellow-600' :
                        'bg-blue-100 text-blue-600'
                      }`}>
                        {ticket.priority}
                      </span>
                      <span className="text-[10px] font-bold text-gray-300">{new Date(ticket.created_at).toLocaleDateString()}</span>
                    </div>
                    <h4 className="text-xl font-black mb-3 line-clamp-2 leading-tight">{ticket.subject}</h4>
                    <p className="text-gray-500 text-sm mb-6 line-clamp-4 leading-relaxed font-medium">{ticket.summary}</p>
                    <div className="mt-auto pt-6 border-t border-gray-50 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gray-50 rounded-full flex items-center justify-center text-gray-400">
                          <User size={14} />
                        </div>
                        <span className="text-xs font-bold">{ticket.caller_id}</span>
                      </div>
                      <button className="text-[#e04f39] text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">Ver Más</button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : activeTab === 'history' ? (
            <motion.div key="history" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
              {/* Financial Stats in History Tab */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard label="Total Minutos" value={stats.totalMins} icon={<Clock size={24} className="text-blue-500" />} trend="Mins" />
                <StatCard label="Gasto Total" value={`$${stats.totalCost}`} icon={<TrendingUp size={24} className="text-green-500" />} trend="USD" />
                <StatCard label="Costo/Min" value={`$${stats.avgCostMin}`} icon={<BarChart3 size={24} className="text-purple-500" />} trend="Avg" />
              </div>

              {/* Spending Chart in History Tab */}
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 flex flex-col">
                <h3 className="font-black text-lg mb-6 text-[#2d2d2d]">Análisis de Gastos Diarios</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={stats.spendingByDay}>
                      <defs>
                        <linearGradient id="colorSpendHist" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#e04f39" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#e04f39" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                      <Tooltip />
                      <Area type="monotone" dataKey="spending" stroke="#e04f39" strokeWidth={3} fillOpacity={1} fill="url(#colorSpendHist)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
                <div className="flex gap-4 mb-8">
                  <div className="flex-1 relative">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input 
                      type="text" 
                      placeholder="Buscar por número..." 
                      className="w-full pl-16 pr-6 py-5 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-orange-500 font-medium transition-all"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <button onClick={fetchCalls} className="bg-[#e04f39] text-white px-10 rounded-2xl font-black text-sm shadow-lg shadow-orange-100">
                    REFRESCAR
                  </button>
                </div>

                <div className="space-y-4">
                  {filteredCalls.map(call => (
                    <div key={call.id} onClick={() => viewTranscripts(call)} className="group flex items-center justify-between p-6 bg-white border border-gray-100 rounded-3xl hover:border-orange-200 hover:shadow-lg hover:shadow-gray-100 transition-all cursor-pointer">
                      <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 group-hover:text-[#e04f39] group-hover:bg-orange-50 transition-all">
                          <Phone size={24} />
                        </div>
                        <div>
                          <p className="font-black text-lg">{call.caller_id}</p>
                          <p className="text-xs text-gray-400 font-bold">{new Date(call.started_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-12">
                        <div className="text-right">
                          <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">Costo</p>
                          <p className="font-black text-[#e04f39] text-sm">${Number(call.cost || 0).toFixed(4)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">Duración</p>
                          <p className="font-bold text-sm">{calculateDuration(call.started_at, call.ended_at)}</p>
                        </div>
                        <ChevronRight className="text-gray-200 group-hover:text-orange-500 transition-all" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white p-16 rounded-[40px] text-center border border-gray-100">
              <Settings size={80} className="mx-auto text-gray-100 mb-8" />
              <h3 className="text-3xl font-black mb-4">Configuración</h3>
              <p className="text-gray-400 max-w-sm mx-auto mb-10">Ajustes globales del sistema de telefonía e inteligencia artificial.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto text-left">
                <div className="p-8 bg-gray-50 rounded-[32px] border border-gray-100">
                   <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Infraestructura</p>
                   <div className="flex justify-between items-center">
                     <span className="font-bold text-sm">SIP Server</span>
                     <span className="text-green-500 font-black text-xs">CONECTADO</span>
                   </div>
                </div>
                <div className="p-8 bg-gray-50 rounded-[32px] border border-gray-100">
                   <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Motor AI</p>
                   <div className="flex justify-between items-center">
                     <span className="font-bold text-sm">GPT-4 / Groq</span>
                     <span className="text-green-500 font-black text-xs">ONLINE</span>
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modal Transcripts */}
      <AnimatePresence>
        {selectedCall && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-900/40 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="bg-white w-full max-w-3xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
              <div className="p-8 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-[#2d2d2d] mb-1">Transcripción Detallada</h3>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{selectedCall.caller_id}</p>
                </div>
                <button onClick={() => setSelectedCall(null)} className="p-3 hover:bg-gray-100 rounded-2xl transition-all"><X /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-gray-50/50">
                {isLoadingTranscripts ? (
                  <div className="h-64 flex items-center justify-center">
                    <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  selectedTranscripts.map((t, i) => (
                    <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-start' : 'items-end'}`}>
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">{t.role === 'user' ? 'Vecino' : 'IA Municipio'}</span>
                      <div className={`p-6 rounded-[32px] max-w-[80%] text-sm leading-relaxed ${t.role === 'user' ? 'bg-white border border-gray-200 text-gray-700 rounded-tl-none shadow-sm' : 'bg-[#e04f39] text-white rounded-tr-none shadow-lg shadow-orange-100'}`}>
                        {t.content}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Incoming Call Alert */}
      <AnimatePresence>
        {showCallAlert && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[150] bg-[#e04f39] p-6 rounded-[40px] shadow-2xl flex items-center gap-8 text-white border border-white/20">
             <div className="w-16 h-16 bg-white/20 rounded-[28px] flex items-center justify-center animate-bounce"><Phone size={32} /></div>
             <div>
               <p className="text-xs font-black uppercase tracking-[0.2em] opacity-60 mb-1">Llamada Entrante</p>
               <p className="text-2xl font-black">{callerId}</p>
             </div>
             <button onClick={() => setShowCallAlert(false)} className="bg-white text-[#e04f39] px-10 py-5 rounded-[28px] font-black text-sm hover:shadow-xl active:scale-95 transition-all">CONTESTAR</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: any) {
  return (
    <div onClick={onClick} className={`flex items-center gap-4 px-6 py-4 rounded-2xl cursor-pointer transition-all ${active ? 'bg-orange-50 text-[#e04f39] font-black' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}>
      {icon}<span className="text-sm font-bold tracking-tight">{label}</span>
    </div>
  );
}

function StatCard({ label, value, icon, trend, isPercent }: any) {
  return (
    <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 flex flex-col justify-between hover:shadow-md transition-all">
      <div className="flex justify-between items-start mb-6">
        <div className="p-4 bg-gray-50 rounded-2xl">{icon}</div>
        <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${trend.includes('+') || isPercent ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{trend}</span>
      </div>
      <div>
        <p className="text-4xl font-black tracking-tighter mb-1">{value}{isPercent && '%'}</p>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">{label}</p>
      </div>
    </div>
  );
}

export default App;
