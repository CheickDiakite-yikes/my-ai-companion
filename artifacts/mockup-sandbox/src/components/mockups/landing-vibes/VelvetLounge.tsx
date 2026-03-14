import React from 'react';
import { Mail, Search, Camera, MessageSquareHeart, CalendarDays, ArrowRight, Menu } from 'lucide-react';

export default function VelvetLounge() {
  return (
    <div className="min-h-screen bg-[#1A0A14] text-[#FDE8D8] font-['Manrope',sans-serif] selection:bg-[#E8B4B8] selection:text-[#1A0A14] overflow-x-hidden">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');
        
        .font-playfair { font-family: 'Playfair Display', serif; }
        .font-manrope { font-family: 'Manrope', sans-serif; }
        
        .orb-glow {
          box-shadow: 0 0 100px 40px rgba(232, 180, 184, 0.15),
                      inset 0 0 80px 20px rgba(183, 148, 244, 0.4);
          animation: pulse-glow 8s ease-in-out infinite alternate;
        }

        .orb-gradient {
          background: radial-gradient(circle at 30% 30%, #E8B4B8 0%, #B794F4 40%, #1C0A1C 100%);
        }

        @keyframes pulse-glow {
          0% {
            box-shadow: 0 0 80px 30px rgba(232, 180, 184, 0.1),
                        inset 0 0 60px 10px rgba(183, 148, 244, 0.3);
            transform: scale(0.98);
          }
          100% {
            box-shadow: 0 0 120px 50px rgba(232, 180, 184, 0.2),
                        inset 0 0 100px 30px rgba(183, 148, 244, 0.5);
            transform: scale(1.02);
          }
        }

        .glass-card {
          background: rgba(45, 18, 48, 0.3);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(232, 180, 184, 0.15);
          box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
        }

        .glass-card:hover {
          background: rgba(45, 18, 48, 0.45);
          border: 1px solid rgba(232, 180, 184, 0.3);
        }

        .bg-velvet {
          background: radial-gradient(ellipse at top, #2D1230 0%, #1A0A14 70%);
        }

        .text-rose-gold {
          color: #E8B4B8;
        }

        .bg-rose-gold {
          background-color: #E8B4B8;
        }

        .border-rose-gold {
          border-color: rgba(232, 180, 184, 0.2);
        }

        .bg-rose-gold-gradient {
          background: linear-gradient(135deg, #FDE8D8 0%, #E8B4B8 50%, #C9A96E 100%);
        }

        .bg-plum-gradient {
          background: linear-gradient(180deg, #2D1230 0%, #1C0A1C 100%);
        }

        /* Subtle sparkle dot pattern */
        .bg-sparkles {
          background-image: radial-gradient(rgba(232, 180, 184, 0.1) 1px, transparent 1px);
          background-size: 40px 40px;
        }
      `}} />

      {/* Background Setup */}
      <div className="fixed inset-0 bg-sparkles pointer-events-none z-0"></div>
      <div className="fixed inset-0 bg-velvet pointer-events-none z-0 opacity-80"></div>

      {/* 1. Navbar */}
      <nav className="fixed top-0 w-full z-50 glass-card rounded-none border-t-0 border-l-0 border-r-0 border-b border-rose-gold">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full orb-gradient shadow-[0_0_15px_rgba(232,180,184,0.3)]"></div>
            <span className="font-playfair text-2xl font-bold tracking-wide text-[#FFF5F0]">ZeeMe</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <button className="text-sm font-medium tracking-wider uppercase text-[#E8B4B8] hover:text-[#FFF5F0] transition-colors">Sign in</button>
            <button className="px-6 py-2.5 rounded-sm bg-rose-gold-gradient text-[#1C0A1C] font-semibold text-sm tracking-wider uppercase hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(232,180,184,0.2)]">
              Meet Zee
            </button>
          </div>
          <button className="md:hidden text-[#E8B4B8]">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </nav>

      <main className="relative z-10 pt-20">
        {/* 2. Hero */}
        <section className="min-h-[90vh] flex flex-col items-center justify-center text-center px-6 relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg aspect-square bg-[#9F7AEA] opacity-10 rounded-full blur-[120px] pointer-events-none"></div>
          
          <div className="mb-10 relative">
            <div className="w-48 h-48 md:w-64 md:h-64 rounded-full orb-gradient orb-glow"></div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 glass-card px-4 py-1.5 rounded-sm border border-rose-gold whitespace-nowrap">
              <span className="text-xs uppercase tracking-[0.2em] text-[#D4A574] font-medium">Companion</span>
            </div>
          </div>

          <div className="max-w-4xl mx-auto mt-8">
            <h1 className="font-playfair text-5xl md:text-7xl lg:text-8xl font-bold leading-tight mb-6 text-[#FFF5F0]">
              Zee, your bestie with <br className="hidden md:block"/>
              <span className="italic font-light text-[#E8B4B8]">real-life superpowers</span>
            </h1>
            <p className="text-lg md:text-xl text-[#D6BCFA] font-light max-w-2xl mx-auto mb-4 tracking-wide">
              An exclusive blend of warm companionship and practical power.
            </p>
            <p className="text-sm md:text-base text-white/50 max-w-xl mx-auto mb-12">
              Experience the luxury of one continuous relationship across voice, text, and reality.
            </p>
            
            <div className="flex flex-col items-center gap-4">
              <button className="px-10 py-4 rounded-sm bg-rose-gold-gradient text-[#1C0A1C] font-semibold text-lg tracking-wider uppercase hover:opacity-90 transition-all hover:scale-105 shadow-[0_0_30px_rgba(232,180,184,0.3)] flex items-center gap-3">
                Meet Zee <ArrowRight className="w-5 h-5" />
              </button>
              <span className="text-xs uppercase tracking-widest text-white/40 mt-2">Free to start</span>
            </div>
          </div>
        </section>

        {/* 3. Features Section (I) */}
        <section className="py-32 px-6 relative border-t border-rose-gold/10 bg-plum-gradient">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-20">
              <div className="flex items-center justify-center gap-4 mb-4">
                <div className="w-12 h-[1px] bg-[#E8B4B8]/30"></div>
                <span className="text-xs uppercase tracking-[0.2em] text-[#D4A574]">Core Capabilities</span>
                <div className="w-12 h-[1px] bg-[#E8B4B8]/30"></div>
              </div>
              <h2 className="font-playfair text-4xl md:text-5xl font-bold text-[#FFF5F0]">Warm companion, practical power</h2>
            </div>

            <div className="grid md:grid-cols-2 gap-6 lg:gap-10">
              {[
                { icon: Mail, title: "Inbox + calendar in conversation", desc: "Your schedule and correspondence woven naturally into your chat." },
                { icon: Search, title: "Grounded web help when needed", desc: "Real-time answers sourced from the web, refined for you." },
                { icon: Camera, title: "Camera-aware everyday guidance", desc: "Share your view and get contextual advice instantly." },
                { icon: MessageSquareHeart, title: "One bestie across voice + text", desc: "A seamless connection whether you're speaking or typing." }
              ].map((feature, i) => (
                <div key={i} className="glass-card p-10 rounded-sm group transition-all duration-500 hover:-translate-y-1">
                  <div className="w-14 h-14 rounded-full bg-[#1C0A1C] border border-rose-gold flex items-center justify-center mb-6 shadow-[0_0_15px_rgba(232,180,184,0.1)] group-hover:shadow-[0_0_20px_rgba(232,180,184,0.3)] transition-shadow duration-500">
                    <feature.icon className="w-6 h-6 text-[#E8B4B8]" />
                  </div>
                  <h3 className="text-2xl font-playfair font-semibold mb-3 text-[#FFF5F0]">{feature.title}</h3>
                  <p className="text-[#D6BCFA]/80 leading-relaxed font-light">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. Use Cases Section */}
        <section className="py-32 px-6 relative">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-20">
              <div className="flex items-center justify-center gap-4 mb-4">
                <div className="w-12 h-[1px] bg-[#E8B4B8]/30"></div>
                <span className="text-xs uppercase tracking-[0.2em] text-[#D4A574]">In Practice</span>
                <div className="w-12 h-[1px] bg-[#E8B4B8]/30"></div>
              </div>
              <h2 className="font-playfair text-4xl md:text-5xl font-bold text-[#FFF5F0]">How Zee fits into your life</h2>
            </div>

            <div className="grid md:grid-cols-2 gap-12">
              {[
                {
                  title: "Calendar and inbox, in your flow",
                  category: "Executive Assist",
                  icon: CalendarDays,
                  desc: "Delegate your schedule and emails without leaving the conversation.",
                  bullets: ["Read inbox context", "Draft thoughtful replies", "Check upcoming meetings", "Coordinate complex schedules"]
                },
                {
                  title: "Web-aware help without tab chaos",
                  category: "Grounded Answers",
                  icon: Search,
                  desc: "Let Zee synthesize the internet for you while you focus on the big picture.",
                  bullets: ["Real-time facts", "Synthesize multiple sources", "Avoid ad-heavy sites", "Direct linked references"]
                },
                {
                  title: "Visual guidance in real moments",
                  category: "Camera Assist",
                  icon: Camera,
                  desc: "Show Zee what you see and receive tailored, intelligent feedback.",
                  bullets: ["Outfit checks", "Translate menus live", "Identify objects", "Step-by-step physical tasks"]
                },
                {
                  title: "Switch modes, keep the same bestie",
                  category: "Voice + Text",
                  icon: MessageSquareHeart,
                  desc: "Talk in the car, type at the desk. The relationship never breaks.",
                  bullets: ["Shared persistent memory", "Emotional continuity", "Live voice interruption", "Natural conversational tone"]
                }
              ].map((story, i) => (
                <div key={i} className="flex flex-col glass-card rounded-sm overflow-hidden group">
                  <div className="h-64 w-full relative overflow-hidden bg-plum-gradient border-b border-rose-gold/20">
                    <div className="absolute inset-0 opacity-50 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#B794F4]/20 via-transparent to-transparent group-hover:scale-110 transition-transform duration-700"></div>
                    <div className="absolute top-6 left-6 px-3 py-1 rounded-sm bg-[#1C0A1C]/80 border border-rose-gold/30 backdrop-blur-md">
                      <span className="text-[10px] uppercase tracking-widest text-[#E8B4B8]">{story.category}</span>
                    </div>
                  </div>
                  <div className="p-10 flex-1 flex flex-col">
                    <div className="flex items-center gap-4 mb-4">
                      <story.icon className="w-5 h-5 text-[#D4A574]" />
                      <h3 className="text-2xl font-playfair font-semibold text-[#FFF5F0]">{story.title}</h3>
                    </div>
                    <p className="text-[#D6BCFA]/70 mb-8 font-light leading-relaxed">{story.desc}</p>
                    <ul className="grid grid-cols-2 gap-4 mt-auto">
                      {story.bullets.map((bullet, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-white/60">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#E8B4B8] mt-1.5 opacity-60"></div>
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Timeline Section (II) */}
        <section className="py-32 px-6 bg-plum-gradient border-y border-rose-gold/10">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-24">
              <div className="flex items-center justify-center gap-4 mb-4">
                <div className="w-12 h-[1px] bg-[#E8B4B8]/30"></div>
                <span className="text-xs uppercase tracking-[0.2em] text-[#D4A574]">Daily Rhythm</span>
                <div className="w-12 h-[1px] bg-[#E8B4B8]/30"></div>
              </div>
              <h2 className="font-playfair text-4xl md:text-5xl font-bold text-[#FFF5F0]">Designed for the pace of real life</h2>
            </div>

            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-[1px] bg-gradient-to-b from-transparent via-[#E8B4B8]/30 to-transparent -translate-x-1/2"></div>
              
              <div className="space-y-16">
                {[
                  { time: "08:00 AM", title: "Morning plan in 30 seconds", icon: CalendarDays, align: "left" },
                  { time: "01:15 PM", title: "Between meetings, still moving", icon: Search, align: "right" },
                  { time: "06:30 PM", title: "Out the door confidence check", icon: Camera, align: "left" }
                ].map((moment, i) => (
                  <div key={i} className={`relative flex flex-col md:flex-row items-start md:items-center gap-8 ${moment.align === 'right' ? 'md:flex-row-reverse' : ''}`}>
                    {/* Center Node */}
                    <div className="absolute left-8 md:left-1/2 top-0 md:top-1/2 -translate-x-1/2 md:-translate-y-1/2 w-4 h-4 rounded-full bg-[#1C0A1C] border-2 border-[#E8B4B8] z-10 shadow-[0_0_10px_rgba(232,180,184,0.5)]"></div>
                    
                    {/* Content */}
                    <div className={`w-full md:w-1/2 pl-20 md:pl-0 ${moment.align === 'left' ? 'md:pr-16 md:text-right' : 'md:pl-16 text-left'}`}>
                      <div className={`glass-card p-8 inline-block w-full max-w-md ${moment.align === 'left' ? 'ml-auto' : 'mr-auto'}`}>
                        <span className="text-xs uppercase tracking-[0.2em] text-[#D4A574] block mb-2">{moment.time}</span>
                        <h3 className="text-xl font-playfair text-[#FFF5F0] flex items-center gap-3 justify-start md:justify-end">
                          {moment.align === 'right' && <moment.icon className="w-5 h-5 text-[#B794F4] hidden md:block" />}
                          {moment.title}
                          {moment.align === 'left' && <moment.icon className="w-5 h-5 text-[#B794F4] hidden md:block" />}
                          <moment.icon className="w-5 h-5 text-[#B794F4] md:hidden" />
                        </h3>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 6. FAQ Section (III) */}
        <section className="py-32 px-6 max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="font-playfair text-4xl md:text-5xl font-bold text-[#FFF5F0]">Questions people ask</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-x-12 gap-y-10">
            {[
              {
                q: "What is ZeeMe?",
                a: "ZeeMe is a multimodal AI companion centered on one continuous relationship with Zee across live voice and text chat."
              },
              {
                q: "Can ZeeMe work as an AI companion and an executive assistant?",
                a: "Yes. ZeeMe blends warm companionship with practical help like Gmail and Google Calendar context, grounded web answers, and approval-aware task support."
              },
              {
                q: "How do live voice and text stay connected?",
                a: "Voice transcripts can persist into the same shared conversation history as text, so users can switch modes without restarting context."
              },
              {
                q: "Can ZeeMe help with Gmail and Google Calendar?",
                a: "Yes. When a user connects Google, ZeeMe can read inbox and calendar context, and it can prepare approval-gated Gmail and Calendar actions in supported flows."
              },
              {
                q: "Is ZeeMe private by design?",
                a: "ZeeMe keeps authenticated chat and profile areas private, uses scoped integrations for Google features, and only exposes public product information on marketing pages."
              }
            ].map((faq, i) => (
              <div key={i} className="group border-b border-rose-gold/10 pb-8 hover:border-rose-gold/40 transition-colors">
                <h3 className="text-xl font-playfair font-medium text-[#FFF5F0] mb-4 group-hover:text-[#E8B4B8] transition-colors">{faq.q}</h3>
                <p className="text-white/60 font-light leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 7. CTA Section */}
        <section className="py-32 px-6 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-plum-gradient opacity-50 z-0"></div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#9F7AEA] opacity-10 blur-[150px] pointer-events-none rounded-t-full"></div>
          
          <div className="relative z-10 max-w-3xl mx-auto flex flex-col items-center">
            <div className="w-24 h-24 rounded-full orb-gradient orb-glow mb-10"></div>
            <h2 className="font-playfair text-5xl md:text-6xl font-bold mb-10 text-[#FFF5F0]">Ready to meet Zee?</h2>
            <button className="px-12 py-4 rounded-sm bg-rose-gold-gradient text-[#1C0A1C] font-semibold text-lg tracking-wider uppercase hover:opacity-90 transition-all hover:scale-105 shadow-[0_0_40px_rgba(232,180,184,0.3)]">
              Meet Zee
            </button>
          </div>
        </section>
      </main>

      {/* 8. Footer */}
      <footer className="py-12 px-6 border-t border-rose-gold/20 relative z-10 bg-[#1A0A14]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full orb-gradient opacity-80"></div>
            <span className="font-playfair text-xl font-bold text-[#FFF5F0]">ZeeMe</span>
          </div>
          
          <div className="flex gap-8 text-sm text-[#D6BCFA]/60 font-light tracking-wide">
            <a href="#" className="hover:text-[#E8B4B8] transition-colors">About us</a>
            <a href="#" className="hover:text-[#E8B4B8] transition-colors">Blog</a>
            <a href="#" className="hover:text-[#E8B4B8] transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-[#E8B4B8] transition-colors">Privacy Policy</a>
          </div>
          
          <div className="text-white/40 text-sm font-light">
            © 2026 ZeeMe
          </div>
        </div>
      </footer>
    </div>
  );
}
