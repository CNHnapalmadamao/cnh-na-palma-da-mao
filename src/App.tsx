import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LogOut, 
  Settings, 
  BookOpen, 
  Trophy, 
  User, 
  ChevronRight, 
  PlayCircle, 
  FileText, 
  Mic, 
  Layers,
  HelpCircle,
  ArrowLeft,
  Search,
  MessageSquare,
  Send,
  X
} from 'lucide-react';
import { DataService } from '../dataService';
import { Subject, Student, ContentType } from '../types';
import { CNH_DATA } from './constants';

// --- HELPERS ---

const getSubjectProgress = (subjectLongName: string, user: Student | null) => {
  if (!user || !user.progress[subjectLongName]) return 0;
  const completed = user.progress[subjectLongName].completed.length;
  
  // Get total content items for this subject
  const content = DataService.state.contentStore[subjectLongName];
  if (!content) return 0;
  
  let total = 0;
  Object.values(content).forEach(list => {
    if (Array.isArray(list)) total += list.length;
  });
  
  return total > 0 ? Math.round((completed / total) * 100) : 0;
};

// --- COMPONENTS ---

const Header = ({ title, onBack, onLogout }: { title: string; onBack?: () => void; onLogout: () => void }) => (
  <header className="header">
    <div className="header-container">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="header-action-btn">
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className="text-lg font-extrabold tracking-tight uppercase truncate max-w-[200px]">
          {title}
        </h1>
      </div>
      <div className="header-actions flex gap-2">
        {DataService.state.currentUserRole === 'manager' && (
          <button className="header-action-btn">
            <Settings size={20} />
          </button>
        )}
        <button onClick={onLogout} className="header-action-btn">
          <LogOut size={20} />
        </button>
      </div>
    </div>
  </header>
);

const StatCard = ({ label, value, progress, icon: Icon, full }: { label: string; value: string | number; progress?: number; icon?: any; full?: boolean }) => (
  <div className={full ? 'stat-card-full' : 'stat-card-mini'}>
    <span className="stat-label">{label}</span>
    <div className="flex items-end gap-2">
      <span className="stat-value">{value}</span>
      {Icon && <Icon size={18} className="text-teal-600 mb-1" />}
    </div>
    {progress !== undefined && (
      <div className="stat-bar">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </div>
    )}
  </div>
);

const SubjectCard = ({ subject, progress, onClick }: { subject: Subject; progress: number; onClick: () => void; key?: any }) => (
  <motion.div 
    whileHover={{ y: -4 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className="subject-card"
  >
    <div className="mb-3 p-3 rounded-2xl bg-teal-50 text-teal-700">
      <BookOpen size={32} />
    </div>
    <h3>{subject.name}</h3>
    <div className="w-full mt-auto">
      <div className="flex justify-between items-center mb-1">
        <span className="card-progress-label">Progresso</span>
        <span className="card-progress-label">{progress}%</span>
      </div>
      <div className="card-progress-mini">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          className="bg-teal-600"
        />
      </div>
    </div>
  </motion.div>
);

const ChatOverlay = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { role: 'ai', text: 'Olá! Eu sou o Sinal Verde. Em que posso te ajudar hoje?' }
  ]);
  const [input, setInput] = useState('');

  if (!isOpen) return null;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="chat-overlay"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="chat-container"
        onClick={e => e.stopPropagation()}
      >
        <div className="chat-header">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-teal-700">
              <MessageSquare size={16} />
            </div>
            <span className="font-bold">Sinal Verde</span>
          </div>
          <button onClick={onClose} className="text-white opacity-70 hover:opacity-100">
            <X size={20} />
          </button>
        </div>
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role === 'user' ? 'user-message' : 'ai-message'}`}>
              {m.text}
            </div>
          ))}
        </div>
        <div className="chat-input-form">
          <div className="chat-input-wrapper">
            <input 
              type="text" 
              placeholder="Tire sua dúvida..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && setInput('')}
            />
            <button className="chat-send-btn">
              <Send size={18} />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

// --- MAIN APP ---

const App = () => {
  const [view, setView] = useState<'login' | 'home' | 'subject' | 'admin'>('home');
  const [user, setUser] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      await DataService.init();
      setUser(DataService.state.currentUser);
      if (!DataService.state.currentUser && DataService.state.currentUserRole !== 'manager') {
        setView('login');
      }
      setLoading(false);
    };
    init();
  }, []);

  const avgProgress = useMemo(() => {
    if (!user) return 0;
    let total = 0;
    CNH_DATA.forEach(s => total += getSubjectProgress(s.longName, user));
    return Math.round(total / (CNH_DATA.length || 1));
  }, [user]);

  const handleLogout = () => {
    DataService.logout();
    setUser(null);
    setView('login');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-gray-500">
        <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin mb-4" />
        <p className="font-medium">Carregando...</p>
      </div>
    );
  }

  return (
    <div id="app-root">
      <AnimatePresence mode="wait">
        {view === 'home' && (
          <motion.div 
            key="home"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="min-h-screen"
          >
            <Header title="CNH na palma da mão" onLogout={handleLogout} />
            
            <main className="pb-20">
              <div className="dashboard-stats">
                <StatCard 
                  label="Progresso Total" 
                  value={`${avgProgress}%`} 
                  progress={avgProgress} 
                  full 
                />
                <StatCard 
                  label="Pontos" 
                  value={user?.points || 0} 
                  icon={Trophy} 
                />
                <StatCard 
                  label="Perfil" 
                  value={user?.name || 'Instrutor'} 
                  icon={User} 
                />
              </div>

              <div className="quick-actions">
                <button className="btn btn-primary">
                  <Layers size={18} /> Simulado
                </button>
                <button className="btn btn-outline">
                  <HelpCircle size={18} /> Dúvidas
                </button>
              </div>

              <div className="px-4 mb-4 flex justify-between items-center">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500">Matérias</h2>
                <div className="p-2 bg-white rounded-xl shadow-sm border border-gray-100">
                  <Search size={16} className="text-gray-400" />
                </div>
              </div>

              <div className="subject-grid">
                {CNH_DATA.map((subject, idx) => (
                  <SubjectCard 
                    key={idx}
                    subject={subject} 
                    progress={getSubjectProgress(subject.longName, user)} 
                    onClick={() => {}} 
                  />
                ))}
              </div>
            </main>

            <div className="fab-container">
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsChatOpen(true)}
                className="fab"
              >
                <MessageSquare size={20} />
                <span>Sinal Verde</span>
              </motion.button>
            </div>

            <ChatOverlay isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
