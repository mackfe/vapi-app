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
  Menu,
  Mail,
  Lock,
  AlertTriangle,
  Play
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
import { apiFetch, API_URL } from './utils/api';

const FISH_VOICES = [
  { label: 'Messi (Español)', id: 'cbc49fd65ff347ccb70f3426cc768a81', gender: 'M' },
  { label: 'Valentino (Español)', id: '8d2c17a9b26d4d83888ea67a1ee565b2', gender: 'M' },
  { label: 'Hugo (Español)', id: 'be47ebe7ff874b799e44865381985978', gender: 'M' },
  { label: 'Matías (Español)', id: '81a7b94456444511a1fd69edc2b6110d', gender: 'M' },
  { label: 'Cristian (Español)', id: '1342b3dbc7e54c5b91cddfc5f98fca74', gender: 'M' },
  { label: 'Carina (Español)', id: '312af98d8ba44e7eaeac90696a93ac40', gender: 'F' },
  { label: 'Carmen (Español)', id: '4322ba92ac0746ca9e24e09158e5c337', gender: 'F' },
  { label: 'Daniela (Español)', id: '55589185654d4d5abc1035280611fb65', gender: 'F' },
  { label: 'Clara (Español)', id: '259103f055f24a1598478cd0966befe4', gender: 'F' },
  { label: 'Voz Personalizada...', id: 'custom', gender: 'all' }
];

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
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('vox_ia_token'));
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [ticketStatusTab, setTicketStatusTab] = useState('pending');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [securityMode, setSecurityMode] = useState<'blacklist' | 'whitelist'>('blacklist');
  const [settingsTab, setSettingsTab] = useState('general');
  const [agents, setAgents] = useState<any[]>([]);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [editingFullAgentId, setEditingFullAgentId] = useState<number | null>(null);
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'M' | 'F'>('all');
  const [newAgent, setNewAgent] = useState({
    name: '',
    phone_number: '',
    ai_model: 'llama-3.3-70b-versatile',
    groq_api_key: '',
    fishaudio_api_key: '',
    voice_reference_id: FISH_VOICES[0].id,
    sip_domain: '',
    sip_user: '',
    sip_password: ''
  });
  const [newBlacklistPhone, setNewBlacklistPhone] = useState('');
  const [newBlacklistDesc, setNewBlacklistDesc] = useState('');
  const [stats, setStats] = useState<any>({ 
    total: 0, 
    answered: 0, 
    byDay: [], 
    spendingByDay: [],
    avgDurationMins: 0,
    totalMins: 0,
    totalCost: 0,
    avgCostMin: 0,
    ticketStats: { total: 0, pending: 0, in_progress: 0, completed: 0 },
    ticketsByDay: []
  });
  const [sipStatus, setSipStatus] = useState('connecting');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const [selectedTranscripts, setSelectedTranscripts] = useState<any[]>([]);
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false);
  const [showCallAlert, setShowCallAlert] = useState(false);
  const [callerId, setCallerId] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchCalls();
    fetchStats();
    fetchTickets();
    if (activeTab === 'settings' && settingsTab === 'security') {
      fetchBlacklist();
      fetchSecurityMode();
    }
    if (activeTab === 'settings' && settingsTab === 'lines') {
      fetchAgents();
    }

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
  }, [isAuthenticated, activeTab, settingsTab]);

  const fetchSecurityMode = async () => {
    try {
      const res = await apiFetch('/api/settings/security_mode');
      const data = await res.json();
      setSecurityMode(data.mode);
    } catch (e) {
      console.error('Error fetching security mode');
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await apiFetch('/api/agents');
      const data = await res.json();
      setAgents(data);
    } catch (e) {
      console.error('Error fetching agents');
    }
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgent.name || !newAgent.phone_number || !newAgent.groq_api_key || !newAgent.fishaudio_api_key || !newAgent.sip_domain || !newAgent.sip_user || !newAgent.sip_password) return;
    try {
      if (editingFullAgentId) {
        await apiFetch(`/api/agents/${editingFullAgentId}`, {
          method: 'PUT',
          body: JSON.stringify(newAgent)
        });
      } else {
        await apiFetch('/api/agents', {
          method: 'POST',
          body: JSON.stringify(newAgent)
        });
      }
      setShowAgentModal(false);
      setEditingFullAgentId(null);
      setNewAgent({ name: '', phone_number: '', ai_model: 'llama-3.3-70b-versatile', groq_api_key: '', fishaudio_api_key: '', voice_reference_id: FISH_VOICES[0].id, sip_domain: '', sip_user: '', sip_password: '' });
      fetchAgents();
    } catch (e) {
      console.error('Error saving agent');
    }
  };

  const handleUpdateVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    try {
      await apiFetch(`/api/agents/${editingAgent.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingAgent)
      });
      setShowVoiceModal(false);
      setEditingAgent(null);
      fetchAgents();
    } catch (e) {
      console.error('Error updating voice');
    }
  };

  const playDemo = async (referenceId: string, apiKey: string) => {
    if (!apiKey) return;
    try {
      const res = await apiFetch('/api/demo/fishaudio', {
        method: 'POST',
        body: JSON.stringify({
          apiKey,
          referenceId,
          text: "Hola, soy el asistente de inteligencia artificial. Esta es una prueba de la voz seleccionada."
        })
      });
      if (!res.ok) throw new Error("Error fetching demo");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(e => {
        alert("Audio de demostración no disponible");
        console.error("Error playing audio:", e);
      });
    } catch (e) {
      alert("Error contactando con la API de FishAudio. Revisa tu API Key.");
    }
  };

  const handleDeleteAgent = async (id: number) => {
    if (!window.confirm('¿Seguro que deseas eliminar este agente?')) return;
    try {
      await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
      fetchAgents();
    } catch (e) {
      console.error('Error deleting agent');
    }
  };

  const handleToggleSecurityMode = async () => {
    const newMode = securityMode === 'blacklist' ? 'whitelist' : 'blacklist';
    try {
      await apiFetch('/api/settings/security_mode', {
        method: 'POST',
        body: JSON.stringify({ mode: newMode })
      });
      setSecurityMode(newMode);
    } catch (e) {
      console.error('Error updating security mode');
    }
  };

  const fetchBlacklist = async () => {
    try {
      const res = await apiFetch('/api/blacklist');
      const data = await res.json();
      setBlacklist(data);
    } catch (e) {
      console.error('Error fetching blacklist');
    }
  };

  const handleAddBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlacklistPhone) return;
    try {
      await apiFetch('/api/blacklist', {
        method: 'POST',
        body: JSON.stringify({ phone_number: newBlacklistPhone, description: newBlacklistDesc })
      });
      setNewBlacklistPhone('');
      setNewBlacklistDesc('');
      fetchBlacklist();
    } catch (e) {
      console.error('Error adding to blacklist');
    }
  };

  const handleRemoveBlacklist = async (id: number) => {
    try {
      await apiFetch(`/api/blacklist/${id}`, { method: 'DELETE' });
      fetchBlacklist();
    } catch (e) {
      console.error('Error removing from blacklist');
    }
  };

  const fetchCalls = async () => {
    try {
      const res = await apiFetch('/api/calls');
      const data = await res.json();
      setCalls(data);
    } catch (e) {
      console.error('Error fetching calls');
    }
  };

  const fetchStats = async () => {
    try {
      const res = await apiFetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error('Error fetching stats');
    }
  };

  const fetchTickets = async () => {
    try {
      const res = await apiFetch('/api/tickets');
      const data = await res.json();
      setTickets(data);
    } catch (e) {
      console.error('Error fetching tickets');
    }
  };

  const updateTicketStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/api/tickets/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      fetchTickets();
      fetchStats();
      setSelectedTicket(null);
    } catch (e) {
      console.error('Error updating ticket status');
    }
  };

  const viewTranscripts = async (call: any) => {
    setSelectedCall(call);
    setIsLoadingTranscripts(true);
    try {
      const res = await apiFetch(`/api/calls/${call.id}/transcripts`);
      const data = await res.json();
      setSelectedTranscripts(data);
    } catch (e) {
      console.error('Error fetching transcripts');
    } finally {
      setIsLoadingTranscripts(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('vox_ia_token', data.token);
        setIsAuthenticated(true);
        setLoginError('');
      } else {
        setLoginError('Credenciales inválidas');
      }
    } catch (error) {
      setLoginError('Error de conexión con el servidor');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('vox_ia_token');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[500px]">
          
          {/* Left Panel - Login Form */}
          <div className="flex-1 p-10 md:p-12 relative flex flex-col justify-center">
            
            {/* Logo */}
            <div className="absolute top-8 left-8 flex items-center gap-2">
              <div className="w-8 h-8 bg-[#e04f39] text-white rounded-lg flex items-center justify-center">
                <Phone className="w-4 h-4" />
              </div>
              <span className="font-black text-xl tracking-tighter text-[#2d2d2d]">Vox.IA</span>
            </div>

            <div className="max-w-xs mx-auto w-full text-center mt-12 md:mt-0">
              <h1 className="text-3xl font-black text-[#e04f39] mb-6">Iniciar sesión</h1>
              
              <p className="text-xs text-gray-400 mb-6 font-medium">Usa tus credenciales de administrador</p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail className="w-5 h-5 text-gray-400" />
                  </div>
                  <input 
                    type="email" 
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 rounded-xl border-none focus:outline-none focus:ring-2 focus:ring-[#e04f39]/20 transition-all font-medium text-gray-700"
                    placeholder="Correo electrónico"
                  />
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-gray-400" />
                  </div>
                  <input 
                    type="password" 
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 rounded-xl border-none focus:outline-none focus:ring-2 focus:ring-[#e04f39]/20 transition-all font-medium text-gray-700"
                    placeholder="Contraseña"
                  />
                </div>
                
                <div className="text-center pt-2">
                  <a href="#" className="text-sm font-semibold text-gray-500 hover:text-[#e04f39] transition-colors">¿Olvidaste tu contraseña?</a>
                </div>

                {loginError && <p className="text-red-500 text-xs font-bold text-center mt-2">{loginError}</p>}

                <div className="pt-4">
                  <button type="submit" className="px-12 py-3 bg-[#e04f39] hover:bg-[#d0432f] text-white rounded-full font-bold uppercase tracking-wider text-sm transition-colors shadow-lg shadow-[#e04f39]/30">
                    INGRESAR
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Right Panel - Welcome Message */}
          <div className="hidden md:flex flex-col justify-center items-center w-[40%] bg-gradient-to-br from-[#e04f39] to-[#ffb600] text-white p-12 text-center relative overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute -top-12 -right-12 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
            <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-black/10 rounded-full blur-2xl"></div>
            
            <h2 className="text-4xl font-black mb-4 z-10">Hola de nuevo</h2>
            <p className="font-medium text-white/90 mb-8 z-10 leading-relaxed">
              Ingresa tus credenciales para acceder al panel de control y gestionar la seguridad de Vox.IA.
            </p>
          </div>

        </div>
      </div>
    );
  }

  const filteredCalls = calls.filter(c => 
    c.caller_id.includes(searchTerm) || c.id.includes(searchTerm)
  );

  const filteredTickets = tickets.filter(t => {
    const matchesSearch = t.subject.toLowerCase().includes(searchTerm.toLowerCase()) || t.caller_id.includes(searchTerm);
    const matchesStatus = t.status === ticketStatusTab;
    const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

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
      <aside className="w-64 bg-white border-r border-gray-100 flex flex-col shadow-sm z-10 relative">
        <div className="h-24 flex items-center px-8 border-b border-gray-50/50 bg-white sticky top-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#e04f39] text-white rounded-xl flex items-center justify-center shadow-lg shadow-[#e04f39]/20">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter leading-none">Vox.IA</h1>
              <p className="text-[9px] uppercase font-bold tracking-[0.2em] text-[#e04f39]">CALL CENTER AI</p>
            </div>
          </div>
        </div>
        <nav className="p-8 space-y-2 flex-1">
          <NavItem icon={<BarChart3 size={20} />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<History size={20} />} label="Llamadas" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
          <NavItem icon={<CheckCircle2 size={20} />} label="Tickets AI" active={activeTab === 'tickets'} onClick={() => setActiveTab('tickets')} />
          <NavItem icon={<Settings size={20} />} label="Configuración" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div className="p-6">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-2xl transition-all font-semibold text-sm"
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 p-10 overflow-y-auto">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h2 className="text-3xl font-black tracking-tight">
              {activeTab === 'dashboard' ? 'Centro de Control' : 
               activeTab === 'tickets' ? 'Módulo de Tickets AI' : 
               activeTab === 'history' ? 'Historial de Llamadas' : 'Ajustes'}
            </h2>
            <p className="text-gray-500 font-medium">Gestionando inteligencia operativa en tiempo real.</p>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' ? (
            <motion.div key="dash" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
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
            <motion.div key="tickets" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Total Tickets" value={stats.ticketStats?.total || 0} icon={<Activity size={24} className="text-blue-500" />} trend="IA" />
                <StatCard label="Sin Atender" value={stats.ticketStats?.pending || 0} icon={<Clock size={24} className="text-red-500" />} trend="New" />
                <StatCard label="En Proceso" value={stats.ticketStats?.in_progress || 0} icon={<Activity size={24} className="text-orange-500" />} trend="Work" />
                <StatCard label="Culminados" value={stats.ticketStats?.completed || 0} icon={<CheckCircle2 size={24} className="text-green-500" />} trend="Done" />
              </div>

              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 flex flex-col">
                <h3 className="font-black text-lg mb-6 text-[#2d2d2d]">Generación de Tickets por Día</h3>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={stats.ticketsByDay}>
                      <defs>
                        <linearGradient id="colorTickets" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                      <Tooltip />
                      <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorTickets)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                  <button 
                    onClick={() => setTicketStatusTab('pending')}
                    className={`px-8 py-3 rounded-xl text-xs font-black transition-all ${ticketStatusTab === 'pending' ? 'bg-white text-[#e04f39] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    SIN ATENDER
                  </button>
                  <button 
                    onClick={() => setTicketStatusTab('in_progress')}
                    className={`px-8 py-3 rounded-xl text-xs font-black transition-all ${ticketStatusTab === 'in_progress' ? 'bg-white text-orange-500 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    EN PROCESO
                  </button>
                  <button 
                    onClick={() => setTicketStatusTab('completed')}
                    className={`px-8 py-3 rounded-xl text-xs font-black transition-all ${ticketStatusTab === 'completed' ? 'bg-white text-green-500 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    CULMINADOS
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Prioridad:</p>
                  <select 
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 text-xs font-bold focus:ring-2 focus:ring-orange-500 transition-all outline-none"
                  >
                    <option value="all">Todas</option>
                    <option value="urgent">Urgente</option>
                    <option value="high">Alta</option>
                    <option value="medium">Media</option>
                    <option value="low">Baja</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredTickets.map(ticket => (
                  <div key={ticket.id} onClick={() => setSelectedTicket(ticket)} className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col group cursor-pointer">
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
                      <button className="text-[#e04f39] text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">Ver Detalle</button>
                    </div>
                  </div>
                ))}
              </div>

              {filteredTickets.length === 0 && (
                <div className="text-center py-20 bg-gray-50 rounded-[40px] border-2 border-dashed border-gray-100">
                  <p className="text-gray-400 font-bold">No hay tickets en este estado con los filtros aplicados.</p>
                </div>
              )}
            </motion.div>
          ) : activeTab === 'history' ? (
            <motion.div key="history" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard label="Total Minutos" value={stats.totalMins} icon={<Clock size={24} className="text-blue-500" />} trend="Mins" />
                <StatCard label="Gasto Total" value={`$${stats.totalCost}`} icon={<TrendingUp size={24} className="text-green-500" />} trend="USD" />
                <StatCard label="Costo/Min" value={`$${stats.avgCostMin}`} icon={<BarChart3 size={24} className="text-purple-500" />} trend="Avg" />
              </div>

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
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white p-16 rounded-[40px] text-center border border-gray-100 min-h-[60vh] flex flex-col">
              <div className="flex items-center gap-6 mb-12 border-b border-gray-100 pb-8 overflow-x-auto">
                <Settings size={40} className="text-gray-200" />
                <h3 className="text-3xl font-black">Configuración</h3>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setSettingsTab('general')} className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${settingsTab === 'general' ? 'bg-[#e04f39] text-white shadow-lg shadow-orange-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>General</button>
                  <button onClick={() => setSettingsTab('lines')} className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${settingsTab === 'lines' ? 'bg-[#e04f39] text-white shadow-lg shadow-orange-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>Líneas / Agentes</button>
                  <button onClick={() => setSettingsTab('security')} className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${settingsTab === 'security' ? 'bg-[#e04f39] text-white shadow-lg shadow-orange-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>Seguridad</button>
                  <button onClick={() => setSettingsTab('kb')} className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${settingsTab === 'kb' ? 'bg-[#e04f39] text-white shadow-lg shadow-orange-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>Base de Conocimiento</button>
                </div>
              </div>

              {settingsTab === 'general' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto text-left w-full">
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
              )}

              {settingsTab === 'lines' && (
                <div className="text-left w-full max-w-6xl mx-auto flex flex-col gap-8">
                  <div className="flex justify-between items-center bg-gray-50 p-8 rounded-[32px] border border-gray-100">
                    <div>
                      <h4 className="font-black text-xl text-[#2d2d2d] mb-1">Agentes y Líneas SIP</h4>
                      <p className="text-sm font-medium text-gray-500">Administra los números y la IA asignada a cada uno.</p>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingFullAgentId(null);
                        setNewAgent({ name: '', phone_number: '', ai_model: 'llama-3.3-70b-versatile', groq_api_key: '', fishaudio_api_key: '', voice_reference_id: FISH_VOICES[0].id, sip_domain: '', sip_user: '', sip_password: '' });
                        setShowAgentModal(true);
                      }} 
                      className="bg-[#e04f39] text-white px-8 py-4 rounded-2xl font-black text-sm shadow-lg shadow-orange-100 hover:scale-105 transition-all"
                    >
                      + AÑADIR AGENTE
                    </button>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-[32px] overflow-hidden shadow-sm">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Agente</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Línea SIP</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Modelo AI</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">API Keys</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {agents.map(agent => (
                          <tr key={agent.id} className="hover:bg-gray-50/50 transition-all">
                            <td className="px-8 py-6 font-bold text-[#2d2d2d]">{agent.name}</td>
                            <td className="px-8 py-6 font-black text-[#e04f39] bg-orange-50/50 rounded-lg inline-block my-4 mx-8">{agent.phone_number}</td>
                            <td className="px-8 py-6 text-xs font-bold text-gray-500 bg-gray-50 rounded-lg inline-block my-4 mx-8 uppercase tracking-wider">{agent.ai_model}</td>
                            <td className="px-8 py-6 text-xs font-medium text-gray-400">
                              Groq: {agent.groq_api_key ? '✅' : '❌'} <br/>
                              FishAudio: {agent.fishaudio_api_key ? '✅' : '❌'}
                            </td>
                            <td className="px-8 py-6 text-right space-x-2">
                              <button onClick={() => { setEditingAgent(agent); setShowVoiceModal(true); }} className="text-[#e04f39] hover:bg-orange-50 px-4 py-2 rounded-xl transition-all font-black text-[10px] uppercase tracking-widest border border-transparent hover:border-orange-200">
                                CONFIGURAR VOZ
                              </button>
                              <button onClick={() => { 
                                setEditingFullAgentId(agent.id); 
                                setNewAgent(agent); 
                                setShowAgentModal(true); 
                              }} className="text-blue-500 hover:bg-blue-50 px-4 py-2 rounded-xl transition-all font-black text-[10px] uppercase tracking-widest border border-transparent hover:border-blue-200">
                                EDITAR
                              </button>
                              <button onClick={() => handleDeleteAgent(agent.id)} className="text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl transition-all font-black text-[10px] uppercase tracking-widest border border-transparent hover:border-red-200">
                                ELIMINAR
                              </button>
                            </td>
                          </tr>
                        ))}
                        {agents.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-8 py-12 text-center font-bold text-gray-400">
                              No hay agentes configurados. El sistema rechazará todas las llamadas.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <AnimatePresence>
                    {showAgentModal && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-[40px] p-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
                          <div className="flex justify-between items-center mb-8">
                            <h3 className="text-2xl font-black">{editingFullAgentId ? 'Editar Agente' : 'Nuevo Agente'}</h3>
                            <button onClick={() => setShowAgentModal(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                              <X size={20} />
                            </button>
                          </div>
                          
                          <form onSubmit={handleSaveAgent} className="flex flex-col gap-6">
                            <div className="grid grid-cols-2 gap-6">
                              <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">Nombre del Agente *</label>
                                <input 
                                  type="text" 
                                  required
                                  placeholder="Ej: Atención de Reclamos"
                                  className="w-full px-6 py-4 bg-gray-50 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                  value={newAgent.name}
                                  onChange={(e) => setNewAgent({...newAgent, name: e.target.value})}
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">Número SIP (Extensión) *</label>
                                <input 
                                  type="text" 
                                  required
                                  placeholder="Ej: 974386"
                                  className="w-full px-6 py-4 bg-gray-50 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                  value={newAgent.phone_number}
                                  onChange={(e) => setNewAgent({...newAgent, phone_number: e.target.value})}
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">Modelo AI</label>
                              <select 
                                className="w-full px-6 py-4 bg-gray-50 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all cursor-pointer"
                                value={newAgent.ai_model}
                                onChange={(e) => setNewAgent({...newAgent, ai_model: e.target.value})}
                              >
                                <option value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile (Recomendado)</option>
                                <option value="llama3-8b-8192">Llama 3 8B (Rápido)</option>
                                <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                              </select>
                            </div>

                            <div className="grid grid-cols-1 gap-6 p-6 bg-gray-50 border border-gray-200 rounded-[24px]">
                                <h4 className="font-black text-sm text-gray-400 uppercase tracking-widest mb-2">Credenciales (API Keys)</h4>
                                <div>
                                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">Groq API Key *</label>
                                  <input 
                                    type="password" 
                                    required
                                    placeholder="gsk_..."
                                    className="w-full px-6 py-4 bg-white rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                    value={newAgent.groq_api_key}
                                    onChange={(e) => setNewAgent({...newAgent, groq_api_key: e.target.value})}
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">FishAudio API Key *</label>
                                  <input 
                                    type="password" 
                                    required
                                    placeholder="sk-..."
                                    className="w-full px-6 py-4 bg-white rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                    value={newAgent.fishaudio_api_key}
                                    onChange={(e) => setNewAgent({...newAgent, fishaudio_api_key: e.target.value})}
                                  />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-6 p-6 bg-orange-50 border border-orange-100 rounded-[24px]">
                                <h4 className="font-black text-sm text-[#e04f39] uppercase tracking-widest mb-2">Conexión Telefónica (SIP Trunk)</h4>
                                <div>
                                  <label className="block text-[10px] font-black text-[#e04f39]/70 uppercase tracking-widest mb-2 px-2">Dominio SIP *</label>
                                  <input 
                                    type="text" 
                                    required
                                    placeholder="Ej: sip.serverdainus.net"
                                    className="w-full px-6 py-4 bg-white rounded-2xl border border-orange-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                    value={newAgent.sip_domain}
                                    onChange={(e) => setNewAgent({...newAgent, sip_domain: e.target.value})}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-6">
                                  <div>
                                    <label className="block text-[10px] font-black text-[#e04f39]/70 uppercase tracking-widest mb-2 px-2">Usuario SIP *</label>
                                    <input 
                                      type="text" 
                                      required
                                      placeholder="Ej: 974386"
                                      className="w-full px-6 py-4 bg-white rounded-2xl border border-orange-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                      value={newAgent.sip_user}
                                      onChange={(e) => setNewAgent({...newAgent, sip_user: e.target.value})}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-black text-[#e04f39]/70 uppercase tracking-widest mb-2 px-2">Contraseña SIP *</label>
                                    <input 
                                      type="password" 
                                      required
                                      placeholder="••••••••"
                                      className="w-full px-6 py-4 bg-white rounded-2xl border border-orange-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                      value={newAgent.sip_password}
                                      onChange={(e) => setNewAgent({...newAgent, sip_password: e.target.value})}
                                    />
                                  </div>
                                </div>
                            </div>

                            <button 
                              type="submit" 
                              disabled={!newAgent.name || !newAgent.phone_number || !newAgent.groq_api_key || !newAgent.fishaudio_api_key}
                              className="mt-4 w-full py-5 bg-[#e04f39] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-orange-100 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                            >
                              Guardar Agente
                            </button>
                          </form>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {showVoiceModal && editingAgent && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-[40px] p-10 w-full max-w-lg shadow-2xl">
                          <div className="flex justify-between items-center mb-8">
                            <div>
                              <h3 className="text-2xl font-black">Catálogo de Voces</h3>
                              <p className="text-xs font-bold text-gray-400 uppercase mt-1">Agente: {editingAgent.name}</p>
                            </div>
                            <button onClick={() => { setShowVoiceModal(false); setEditingAgent(null); }} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                              <X size={20} />
                            </button>
                          </div>
                          
                          <form onSubmit={handleUpdateVoice} className="flex flex-col gap-6">
                            <div>
                              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">Catálogo de Plantillas</label>
                              <div className="flex flex-col gap-4">
                                <div className="flex gap-2 px-2">
                                  <button type="button" onClick={() => setVoiceGenderFilter('all')} className={`flex-1 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${voiceGenderFilter === 'all' ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>TODAS</button>
                                  <button type="button" onClick={() => setVoiceGenderFilter('M')} className={`flex-1 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${voiceGenderFilter === 'M' ? 'bg-blue-500 text-white shadow-md shadow-blue-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>HOMBRES</button>
                                  <button type="button" onClick={() => setVoiceGenderFilter('F')} className={`flex-1 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${voiceGenderFilter === 'F' ? 'bg-pink-500 text-white shadow-md shadow-pink-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>MUJERES</button>
                                </div>
                                <select 
                                  className="w-full px-6 py-4 bg-gray-50 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all cursor-pointer"
                                  value={FISH_VOICES.some(v => v.id === editingAgent.voice_reference_id) ? editingAgent.voice_reference_id : 'custom'}
                                  onChange={(e) => {
                                    if (e.target.value !== 'custom') {
                                      setEditingAgent({...editingAgent, voice_reference_id: e.target.value});
                                    }
                                  }}
                                >
                                  <option value="custom" disabled>Selecciona una plantilla (opcional)...</option>
                                  {FISH_VOICES.filter(v => v.id !== 'custom' && (voiceGenderFilter === 'all' || v.gender === voiceGenderFilter)).map(voice => (
                                    <option key={voice.id} value={voice.id}>{voice.label}</option>
                                  ))}
                                </select>
                                
                                <div className="flex gap-4">
                                  <input 
                                    type="text" 
                                    placeholder="Pega aquí tu Reference ID de FishAudio"
                                    className="flex-1 px-6 py-4 bg-white rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                                    value={editingAgent.voice_reference_id}
                                    onChange={(e) => setEditingAgent({...editingAgent, voice_reference_id: e.target.value})}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => playDemo(editingAgent.voice_reference_id, editingAgent.fishaudio_api_key)}
                                    className="bg-[#e04f39]/10 hover:bg-[#e04f39]/20 text-[#e04f39] px-6 py-4 rounded-2xl font-bold text-sm transition-all flex items-center gap-2"
                                  >
                                    <Play size={16} /> Probar
                                  </button>
                                </div>
                              </div>
                            </div>

                            <button 
                              type="submit" 
                              className="mt-4 w-full py-5 bg-[#e04f39] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-orange-100 hover:scale-[1.02] transition-all"
                            >
                              Guardar Voz
                            </button>
                          </form>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {settingsTab === 'kb' && (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <p className="font-bold">Base de Conocimiento - Próximamente (Fase 3)</p>
                </div>
              )}

              {settingsTab === 'security' && (
                <div className="text-left w-full max-w-4xl mx-auto flex flex-col gap-8">
                  {/* Switch de Seguridad */}
                  <div className="bg-gray-50 p-8 rounded-[32px] border border-gray-100 flex items-center justify-between">
                    <div>
                      <h4 className="font-black text-lg text-[#2d2d2d] mb-1">Modo de Seguridad</h4>
                      <p className="text-sm font-medium text-gray-500">
                        {securityMode === 'blacklist' 
                          ? 'Lista Negra: Se permiten todas las llamadas excepto las listadas abajo.' 
                          : 'Lista Blanca: SE BLOQUEAN todas las llamadas excepto las listadas abajo.'}
                      </p>
                    </div>
                    <button 
                      onClick={handleToggleSecurityMode}
                      className={`relative w-20 h-10 rounded-full transition-colors duration-300 ${securityMode === 'whitelist' ? 'bg-[#e04f39]' : 'bg-gray-300'}`}
                    >
                      <span 
                        className={`absolute top-1 left-1 bg-white w-8 h-8 rounded-full transition-transform duration-300 shadow-md ${securityMode === 'whitelist' ? 'transform translate-x-10' : ''}`}
                      />
                    </button>
                  </div>

                  {securityMode === 'whitelist' && (
                    <div className="bg-orange-50 border border-orange-200 text-[#e04f39] p-6 rounded-2xl flex items-center gap-4">
                      <AlertTriangle size={24} />
                      <div>
                        <h5 className="font-bold">Atención: Modo Lista Blanca estricto activado</h5>
                        <p className="text-sm">El sistema rechazará automáticamente cualquier llamada que no coincida con los números o patrones de la lista.</p>
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 p-8 rounded-[32px] border border-gray-100">
                    <h4 className="font-black text-lg mb-6 text-[#2d2d2d]">
                      {securityMode === 'blacklist' ? 'Agregar a Lista Negra' : 'Agregar a Lista Blanca'}
                    </h4>
                    <form onSubmit={handleAddBlacklist} className="flex flex-col gap-4">
                      <div className="flex gap-4">
                        <div className="flex-1 relative">
                          <input 
                            type="text" 
                            placeholder="Número o Patrón..." 
                            className="w-full px-6 py-4 bg-white rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                            value={newBlacklistPhone}
                            onChange={(e) => setNewBlacklistPhone(e.target.value)}
                            required
                          />
                          <p className="text-xs text-gray-400 mt-2 font-medium px-2">Tip: Puedes usar '%' al final para códigos de país o prefijos completos (Ej. +7% o 00%).</p>
                        </div>
                        <input 
                          type="text" 
                          placeholder="Descripción (opcional)" 
                          className="flex-1 h-14 px-6 py-4 bg-white rounded-2xl border border-gray-200 focus:ring-2 focus:ring-[#e04f39] outline-none font-medium text-sm transition-all"
                          value={newBlacklistDesc}
                          onChange={(e) => setNewBlacklistDesc(e.target.value)}
                        />
                        <button type="submit" className="h-14 bg-[#e04f39] text-white px-8 rounded-2xl font-black text-sm shadow-lg shadow-orange-100 hover:scale-105 transition-all">
                          {securityMode === 'blacklist' ? 'BLOQUEAR' : 'PERMITIR'}
                        </button>
                      </div>
                    </form>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-[32px] overflow-hidden shadow-sm">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Número / Patrón</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Descripción</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha</th>
                          <th className="px-8 py-5 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {blacklist.map(item => (
                          <tr key={item.id} className="hover:bg-gray-50/50 transition-all">
                            <td className="px-8 py-5 font-bold text-[#2d2d2d]">{item.phone_number}</td>
                            <td className="px-8 py-5 font-medium text-gray-500">{item.description || '-'}</td>
                            <td className="px-8 py-5 font-bold text-xs text-gray-400">{new Date(item.created_at).toLocaleDateString()}</td>
                            <td className="px-8 py-5 text-right">
                              <button onClick={() => handleRemoveBlacklist(item.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-xl transition-all font-black text-[10px] uppercase tracking-widest">
                                ELIMINAR
                              </button>
                            </td>
                          </tr>
                        ))}
                        {blacklist.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-8 py-10 text-center font-bold text-gray-400">
                              {securityMode === 'blacklist' 
                                ? 'No hay números en la lista negra.' 
                                : 'No hay números permitidos. Se bloquearán todas las llamadas.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
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

      {/* Ticket Details Modal */}
      <AnimatePresence>
        {selectedTicket && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-900/40 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden">
              <div className="p-10 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                    selectedTicket.priority === 'urgent' ? 'bg-red-50 text-red-500' :
                    selectedTicket.priority === 'high' ? 'bg-orange-50 text-orange-500' :
                    'bg-blue-50 text-blue-500'
                  }`}>
                    <Activity size={24} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-[#2d2d2d] mb-1">Detalle del Ticket</h3>
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">ID: #{selectedTicket.id} | Llamante: {selectedTicket.caller_id}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedTicket(null)} className="p-3 hover:bg-gray-100 rounded-2xl transition-all"><X /></button>
              </div>
              
              <div className="p-10 space-y-8">
                <div>
                  <label className="text-[10px] font-black text-gray-300 uppercase tracking-widest block mb-4">Asunto de la Llamada</label>
                  <p className="text-xl font-black text-[#2d2d2d] leading-tight">{selectedTicket.subject}</p>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-300 uppercase tracking-widest block mb-4">Resumen Inteligente</label>
                  <p className="text-gray-500 leading-relaxed font-medium bg-gray-50 p-8 rounded-[32px] border border-gray-100 italic">
                    "{selectedTicket.summary}"
                  </p>
                </div>

                <div className="pt-6 border-t border-gray-50 flex flex-col gap-4">
                  <label className="text-[10px] font-black text-gray-300 uppercase tracking-widest block mb-2">Gestionar Estado</label>
                  <div className="grid grid-cols-2 gap-4">
                    {selectedTicket.status !== 'in_progress' && (
                      <button 
                        onClick={() => updateTicketStatus(selectedTicket.id, 'in_progress')}
                        className="bg-orange-50 text-orange-500 px-8 py-5 rounded-2xl font-black text-xs hover:bg-orange-100 transition-all border border-orange-100"
                      >
                        MARCAR EN PROCESO
                      </button>
                    )}
                    {selectedTicket.status !== 'completed' && (
                      <button 
                        onClick={() => updateTicketStatus(selectedTicket.id, 'completed')}
                        className="bg-green-50 text-green-500 px-8 py-5 rounded-2xl font-black text-xs hover:bg-green-100 transition-all border border-green-100"
                      >
                        MARCAR CULMINADO
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
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
