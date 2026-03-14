import React from 'react';
import { Mail, Search, Camera, MessageSquareHeart, CalendarDays, ArrowRight } from 'lucide-react';

export function MidnightClarity() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 font-['DM_Sans'] selection:bg-sky-500/30">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Outfit:wght@300;400;500;600;700&display=swap');
        
        .bg-grid-pattern {
          background-image: 
            linear-gradient(to right, rgba(56, 189, 248, 0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(56, 189, 248, 0.05) 1px, transparent 1px);
          background-size: 40px 40px;
        }

        .orb-glow {
          box-shadow: 0 0 80px 20px rgba(56, 189, 248, 0.4),
                      inset 0 0 40px rgba(125, 211, 252, 0.8);
          animation: pulse-glow 4s ease-in-out infinite alternate;
        }

        @keyframes pulse-glow {
          0% {
            box-shadow: 0 0 80px 20px rgba(56, 189, 248, 0.3),
                        inset 0 0 40px rgba(125, 211, 252, 0.6);
            transform: scale(1);
          }
          100% {
            box-shadow: 0 0 100px 30px rgba(56, 189, 248, 0.5),
                        inset 0 0 60px rgba(125, 211, 252, 0.9);
            transform: scale(1.02);
          }
        }
      `}} />

      {/* 1. Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-sky-400 orb-glow"></div>
            <span className="font-['Outfit'] font-bold text-xl tracking-wide text-white">ZeeMe</span>
          </div>
          <button className="text-sm font-medium text-slate-300 hover:text-white transition-colors px-4 py-2">
            Sign in
          </button>
        </div>
      </nav>

      {/* 2. Hero */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 px-6 overflow-hidden flex flex-col items-center text-center bg-grid-pattern min-h-screen justify-center">
        {/* Decorative background gradients */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col items-center max-w-4xl mx-auto">
          <div className="mb-8 inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sky-500/30 bg-sky-500/10">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
            <span className="text-xs font-['Outfit'] font-medium uppercase tracking-widest text-sky-300">Companion</span>
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
          </div>
          
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-gradient-to-br from-sky-300 to-blue-600 mb-10 orb-glow"></div>
          
          <h1 className="font-['Outfit'] text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 leading-tight">
            Zee, your bestie with <br className="hidden md:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-slate-200">real-life superpowers</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-slate-300 font-['DM_Sans'] italic mb-6 max-w-2xl font-light">
            An intelligence that remembers your context, handles your digital chores, and actually gets you.
          </p>
          
          <p className="text-slate-400 text-sm md:text-base max-w-xl mb-10">
            Connect your world and let Zee handle the details while keeping your data private and secure.
          </p>
          
          <div className="flex flex-col items-center gap-4">
            <button className="group relative px-8 py-4 bg-sky-400 hover:bg-sky-300 text-slate-900 font-['Outfit'] font-semibold text-lg rounded-lg transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
              <span className="relative flex items-center gap-2">
                Meet Zee <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
            <span className="text-xs font-['Outfit'] text-slate-500 uppercase tracking-wider">Free to start</span>
          </div>
        </div>
      </section>

      {/* 3. Features Section (I) */}
      <section className="py-24 px-6 border-t border-slate-800 relative z-10 bg-slate-900">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-['Outfit'] text-3xl md:text-4xl font-semibold text-white tracking-wide">
              Warm companion, <span className="text-sky-400">practical power</span>
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { icon: Mail, title: "Smart Inbox Management", desc: "Zee drafts replies, sorts the noise, and highlights what matters." },
              { icon: Search, title: "Universal Search", desc: "Find any photo, file, or memory across your entire digital footprint." },
              { icon: Camera, title: "Visual Intelligence", desc: "Point your camera and Zee understands the context instantly." },
              { icon: MessageSquareHeart, title: "Always Here to Chat", desc: "A sounding board, a brainstorm partner, or just someone to listen." }
            ].map((feat, i) => (
              <div key={i} className="group p-8 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:border-sky-500/40 hover:bg-slate-800/80 transition-all duration-300 flex flex-col items-start text-left">
                <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center mb-6 group-hover:border-sky-500/50 group-hover:text-sky-400 text-slate-300 transition-colors">
                  <feat.icon className="w-6 h-6" />
                </div>
                <h3 className="font-['Outfit'] text-xl font-medium text-slate-100 mb-3">{feat.title}</h3>
                <p className="text-slate-400 leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Use Cases Section */}
      <section className="py-24 px-6 relative z-10 bg-slate-900/50">
        <div className="max-w-6xl mx-auto space-y-24">
          {[
            {
              title: "Morning Briefings, perfectly tuned.",
              desc: "Start your day with clarity. Zee reviews your schedule, flags urgent emails, and prepares what you need before you even ask.",
              bullets: ["Calendar sync & conflict resolution", "Prioritized communications", "Commute & weather awareness"],
              icon: Zap,
              gradient: "from-sky-500/20 to-indigo-500/20"
            },
            {
              title: "Your memory, perfectly organized.",
              desc: "Never lose a thought. Tell Zee an idea on your commute, and find it neatly organized in your notes when you get to your desk.",
              bullets: ["Cross-platform recall", "Contextual tagging", "Voice-to-text accuracy"],
              icon: Search,
              gradient: "from-blue-500/20 to-cyan-500/20",
              reverse: true
            },
            {
              title: "Visual problem solving.",
              desc: "Stuck on a manual? Need to translate a sign? Show Zee through your camera and get immediate, context-aware assistance.",
              bullets: ["Real-time object recognition", "Live translation", "Step-by-step guidance"],
              icon: Camera,
              gradient: "from-indigo-500/20 to-sky-500/20"
            },
            {
              title: "Private by design.",
              desc: "Your data is yours. Zee processes your personal information with strict on-device boundaries and enterprise-grade encryption.",
              bullets: ["Local processing options", "End-to-end encryption", "Zero data selling"],
              icon: Shield,
              gradient: "from-slate-600/20 to-sky-900/20",
              reverse: true
            }
          ].map((useCase, i) => (
            <div key={i} className={`flex flex-col ${useCase.reverse ? 'md:flex-row-reverse' : 'md:flex-row'} gap-12 items-center`}>
              <div className="w-full md:w-1/2 aspect-[4/3] rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden relative group">
                <div className={`absolute inset-0 bg-gradient-to-br ${useCase.gradient} opacity-50 group-hover:opacity-100 transition-opacity duration-700`}></div>
                {/* Geometric decorative elements inside placeholder */}
                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                  <div className="w-32 h-32 border border-current rounded-full absolute mix-blend-overlay"></div>
                  <div className="w-48 h-48 border border-current rounded-full absolute mix-blend-overlay"></div>
                  <div className="w-full h-[1px] bg-current absolute top-1/2"></div>
                  <div className="w-[1px] h-full bg-current absolute left-1/2"></div>
                </div>
              </div>
              <div className="w-full md:w-1/2 flex flex-col items-start">
                <div className="w-10 h-10 rounded bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mb-6">
                  <useCase.icon className="w-5 h-5" />
                </div>
                <h3 className="font-['Outfit'] text-3xl font-semibold text-slate-100 mb-4">{useCase.title}</h3>
                <p className="text-slate-400 text-lg mb-8 leading-relaxed">{useCase.desc}</p>
                <ul className="grid grid-cols-1 gap-3 w-full">
                  {useCase.bullets.map((bullet, j) => (
                    <li key={j} className="flex items-center gap-3 text-slate-300 bg-slate-800/40 p-3 rounded-md border border-slate-700/30">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400"></div>
                      <span className="font-medium text-sm">{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Timeline Section (II) */}
      <section className="py-24 px-6 border-y border-slate-800 relative z-10 bg-slate-900">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-['Outfit'] text-3xl md:text-4xl font-semibold text-white mb-16 tracking-wide">
            Designed for the pace of <span className="text-sky-400">real life</span>
          </h2>
          
          <div className="relative border-l border-slate-700 ml-6 md:ml-0 md:border-l-0 md:border-t pt-8 md:pt-0 md:pl-0 md:flex md:justify-between text-left md:text-center space-y-12 md:space-y-0">
            {[
              { time: "08:00 AM", title: "Morning Sync", desc: "Zee prepares your brief and drafts urgent replies.", icon: CalendarDays },
              { time: "02:00 PM", title: "Meeting Prep", desc: "Pulls up relevant files and context right when you need them.", icon: Search },
              { time: "07:00 PM", title: "Evening Wrap", desc: "Summarizes the day and helps you disconnect.", icon: MessageSquareHeart }
            ].map((step, i) => (
              <div key={i} className="relative pl-8 md:pl-0 md:pt-12 md:flex-1 md:px-4">
                <div className="absolute left-[-5px] md:left-1/2 md:-translate-x-1/2 top-0 md:top-[-5px] w-2.5 h-2.5 rounded-full bg-sky-400 ring-4 ring-slate-900"></div>
                <div className="flex flex-col md:items-center">
                  <div className="text-sky-400 font-['Outfit'] text-sm font-bold tracking-widest mb-2">{step.time}</div>
                  <h4 className="text-xl font-semibold text-slate-100 mb-2 font-['Outfit']">{step.title}</h4>
                  <p className="text-slate-400 text-sm md:max-w-[200px] leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. FAQ Section (III) */}
      <section className="py-24 px-6 relative z-10 bg-slate-900/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-['Outfit'] text-3xl md:text-4xl font-semibold text-white tracking-wide">
              Questions people ask
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { q: "How does Zee protect my privacy?", a: "Zee operates with strictly defined boundaries. Your data remains yours, processed securely and never used to train global models without explicit consent." },
              { q: "Does Zee integrate with my calendar?", a: "Yes. Zee seamlessly connects with Google Calendar, Outlook, and Apple Calendar to manage scheduling and conflict resolution automatically." },
              { q: "Is Zee always listening?", a: "Only when you want it to. You have full hardware and software controls to decide when Zee is active and paying attention." },
              { q: "Can I use Zee on multiple devices?", a: "Absolutely. Zee syncs instantly across your phone, desktop, and web, maintaining your context everywhere." }
            ].map((faq, i) => (
              <div key={i} className="bg-slate-800/40 border border-slate-700/50 p-8 rounded-lg hover:bg-slate-800/60 transition-colors">
                <h4 className="font-['Outfit'] text-lg font-medium text-slate-100 mb-3">{faq.q}</h4>
                <p className="text-slate-400 leading-relaxed text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. CTA Section */}
      <section className="py-32 px-6 relative z-10 overflow-hidden border-t border-slate-800 bg-slate-900">
        <div className="absolute inset-0 bg-grid-pattern opacity-50 pointer-events-none"></div>
        <div className="max-w-3xl mx-auto text-center relative z-20 flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-sky-300 to-blue-600 mb-10 orb-glow"></div>
          <h2 className="font-['Outfit'] text-4xl md:text-5xl font-bold text-white mb-8 tracking-tight">
            Ready to meet your new bestie?
          </h2>
          <button className="px-8 py-4 bg-sky-400 hover:bg-sky-300 text-slate-900 font-['Outfit'] font-semibold text-lg rounded-lg transition-all duration-300 flex items-center gap-2">
            Meet Zee <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="border-t border-slate-800 py-12 px-6 bg-slate-950 relative z-10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-sky-400"></div>
            <span className="font-['Outfit'] font-bold text-lg text-slate-300">ZeeMe</span>
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            <a href="#" className="hover:text-slate-300 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-slate-300 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-slate-300 transition-colors">Contact</a>
          </div>
          <div>
            &copy; {new Date().getFullYear()} ZeeMe. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
