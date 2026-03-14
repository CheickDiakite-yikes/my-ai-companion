import React, { useEffect, useState } from "react";
import {
  Mail,
  Search,
  Camera,
  MessageSquareHeart,
  CalendarDays,
  ArrowRight,
  ChevronDown,
  Sparkles
} from "lucide-react";

const SunlitStudio = () => {
  return (
    <div className="min-h-screen bg-[#FFFBF5] text-[#292524] font-['DM_Sans',sans-serif] selection:bg-[#FB923C] selection:text-white">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&display=swap');
        
        .font-serif {
          font-family: 'Fraunces', serif;
        }
        
        .orb-glow {
          box-shadow: 0 0 60px 20px rgba(234, 88, 12, 0.15),
                      inset 0 0 40px 10px rgba(251, 146, 60, 0.2);
          animation: pulse-glow 4s ease-in-out infinite alternate;
        }

        .orb-glow-small {
          box-shadow: 0 0 30px 10px rgba(234, 88, 12, 0.15),
                      inset 0 0 20px 5px rgba(251, 146, 60, 0.2);
          animation: pulse-glow-small 4s ease-in-out infinite alternate;
        }

        @keyframes pulse-glow {
          0% {
            box-shadow: 0 0 50px 15px rgba(234, 88, 12, 0.1),
                        inset 0 0 30px 10px rgba(251, 146, 60, 0.15);
            transform: scale(0.98);
          }
          100% {
            box-shadow: 0 0 80px 25px rgba(234, 88, 12, 0.25),
                        inset 0 0 50px 15px rgba(251, 146, 60, 0.3);
            transform: scale(1.02);
          }
        }

        @keyframes pulse-glow-small {
          0% {
            box-shadow: 0 0 25px 8px rgba(234, 88, 12, 0.1),
                        inset 0 0 15px 5px rgba(251, 146, 60, 0.15);
            transform: scale(0.98);
          }
          100% {
            box-shadow: 0 0 40px 12px rgba(234, 88, 12, 0.25),
                        inset 0 0 25px 8px rgba(251, 146, 60, 0.3);
            transform: scale(1.02);
          }
        }
      `}} />

      {/* 1. Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#FFFBF5]/90 backdrop-blur-md border-b border-[#E7E5E4] px-6 py-4 flex justify-between items-center transition-all duration-300">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-[#C2410C] to-[#FB923C]" />
          <span className="font-serif text-xl font-semibold text-[#292524] tracking-tight">ZeeMe</span>
        </div>
        <button className="text-[#44403C] hover:text-[#C2410C] font-medium text-sm transition-colors duration-200">
          Sign in
        </button>
      </nav>

      {/* 2. Hero */}
      <section className="relative min-h-[100svh] flex flex-col items-center justify-center px-6 pt-24 pb-16 overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-[#EA580C] opacity-40"></div>
        <div className="absolute top-1/3 right-1/4 w-3 h-3 rounded-full bg-[#84CC16] opacity-30"></div>
        <div className="absolute bottom-1/4 left-1/3 w-1.5 h-1.5 rounded-full bg-[#C2410C] opacity-50"></div>
        <svg className="absolute top-1/2 right-1/5 opacity-10 text-[#C2410C] w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
           <path d="M12 2C12 2 12 10 20 12C12 14 12 22 12 22C12 22 12 14 4 12C12 10 12 2 12 2Z" fill="currentColor"/>
        </svg>

        <div className="max-w-4xl mx-auto flex flex-col items-center text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] text-xs font-semibold uppercase tracking-wider mb-8 shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
            Companion
          </div>

          <div className="relative mb-10 mt-4">
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-gradient-to-br from-[#FFF7ED] via-[#FFEDD5] to-[#FB923C] orb-glow flex items-center justify-center border border-[#FED7AA]/50">
              <div className="w-full h-full rounded-full bg-gradient-to-tr from-transparent to-white/40 absolute top-0 left-0" />
            </div>
          </div>

          <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl text-[#292524] font-medium leading-[1.05] tracking-tight mb-6 max-w-3xl">
            Zee, your bestie with <span className="text-[#C2410C] relative whitespace-nowrap">
              real-life superpowers
              <svg className="absolute -bottom-2 left-0 w-full h-3 text-[#FED7AA]" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="3" fill="none" />
              </svg>
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-[#44403C] font-serif italic mb-8 max-w-2xl leading-relaxed">
            Calendar and inbox context, grounded web answers, and camera-aware everyday guidance.
          </p>

          <p className="text-base md:text-lg text-[#78716C] mb-10 max-w-xl">
            Experience one continuous relationship across live voice and text chat. Technology that feels human.
          </p>

          <div className="flex flex-col items-center gap-4">
            <button className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-[#C2410C] text-white text-lg font-medium rounded-xl shadow-[0_8px_20px_-6px_rgba(194,65,12,0.4)] hover:bg-[#9A3412] hover:shadow-[0_12px_25px_-8px_rgba(194,65,12,0.5)] transition-all duration-300 hover:-translate-y-0.5">
              Meet Zee
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />
            </button>
            <span className="text-sm text-[#78716C] font-medium">Free to start</span>
          </div>
        </div>
      </section>

      {/* 3. Features Section (I) */}
      <section className="py-24 px-6 bg-[#FAFAF9] relative border-y border-[#E7E5E4]/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-4xl text-[#292524] mb-4">Warm companion, practical power</h2>
            <div className="w-16 h-0.5 bg-[#EA580C] mx-auto rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
            {[
              { icon: Mail, title: "Inbox + calendar in conversation", color: "text-[#C2410C]", bg: "bg-[#FFF7ED]" },
              { icon: Search, title: "Grounded web help when needed", color: "text-[#65A30D]", bg: "bg-[#ECFCCB]/50" },
              { icon: Camera, title: "Camera-aware everyday guidance", color: "text-[#0284C7]", bg: "bg-[#E0F2FE]/50" },
              { icon: MessageSquareHeart, title: "One bestie across voice + text", color: "text-[#D946EF]", bg: "bg-[#FAE8FF]/50" }
            ].map((feature, i) => (
              <div key={i} className="group p-8 rounded-2xl bg-white shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border border-[#F5F5F4] hover:shadow-[0_8px_30px_-12px_rgba(194,65,12,0.15)] transition-all duration-300 hover:-translate-y-1 flex items-start gap-6">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${feature.bg}`}>
                  <feature.icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <div className="pt-2">
                  <h3 className="text-xl font-medium text-[#292524]">{feature.title}</h3>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Use Cases Section */}
      <section className="py-24 px-6 bg-[#FFFBF5]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: CalendarDays,
                title: "Calendar and inbox, in your flow",
                desc: "ZeeMe can read inbox and calendar context, and prepare approval-gated actions.",
                bullets: ["Draft emails", "Schedule meetings", "Daily briefings"]
              },
              {
                icon: Search,
                title: "Web-aware help without tab chaos",
                desc: "Grounded web answers integrated naturally into your conversation.",
                bullets: ["Fact-checking", "Research summaries", "Latest news"]
              },
              {
                icon: Camera,
                title: "Visual guidance in real moments",
                desc: "Share what you're seeing and get contextual advice instantly.",
                bullets: ["Object recognition", "Style advice", "Visual translations"]
              },
              {
                icon: MessageSquareHeart,
                title: "Switch modes, keep the same bestie",
                desc: "Voice transcripts persist into the same shared history as text chat.",
                bullets: ["Continuous context", "Live voice mode", "Seamless switching"]
              }
            ].map((useCase, i) => (
              <div key={i} className="flex flex-col bg-white rounded-2xl overflow-hidden border border-[#E7E5E4] shadow-[0_4px_15px_-10px_rgba(0,0,0,0.05)] transition-transform hover:-translate-y-1 duration-300 group">
                <div className="h-48 w-full bg-gradient-to-br from-[#FFF7ED] to-[#FFEDD5] relative overflow-hidden flex items-center justify-center">
                  {/* Abstract placeholder visual */}
                  <div className="w-32 h-32 rounded-full border border-[#FB923C]/20 absolute -right-10 -top-10"></div>
                  <div className="w-24 h-24 rounded-full border border-[#84CC16]/20 absolute -left-5 -bottom-5"></div>
                  <useCase.icon className="w-12 h-12 text-[#FB923C] opacity-50 group-hover:scale-110 transition-transform duration-500" strokeWidth={1.5} />
                </div>
                <div className="p-6 flex-1 flex flex-col">
                  <div className="flex items-center gap-3 mb-3">
                    <useCase.icon className="w-5 h-5 text-[#C2410C]" />
                    <h3 className="font-serif text-lg text-[#292524] font-medium leading-tight">{useCase.title}</h3>
                  </div>
                  <p className="text-[#78716C] text-sm mb-6 flex-1">{useCase.desc}</p>
                  <ul className="space-y-2">
                    {useCase.bullets.map((bullet, j) => (
                      <li key={j} className="flex items-center gap-2 text-xs font-medium text-[#44403C]">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#84CC16]"></div>
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
      <section className="py-24 px-6 bg-white border-y border-[#E7E5E4]/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-4xl text-[#292524] mb-4">Designed for the pace of real life</h2>
            <div className="w-16 h-0.5 bg-[#84CC16] mx-auto rounded-full"></div>
          </div>

          <div className="relative border-l-2 border-[#F5F5F4] ml-6 md:ml-12 space-y-12 pb-4">
            {[
              { time: "08:00 AM", title: "Morning plan in 30 seconds", icon: CalendarDays, color: "text-[#C2410C]", bg: "bg-[#FFF7ED]", border: "border-[#FED7AA]" },
              { time: "12:30 PM", title: "Between meetings, still moving", icon: Search, color: "text-[#65A30D]", bg: "bg-[#ECFCCB]", border: "border-[#D9F99D]" },
              { time: "06:15 PM", title: "Out the door confidence check", icon: Camera, color: "text-[#0284C7]", bg: "bg-[#E0F2FE]", border: "border-[#BAE6FD]" }
            ].map((moment, i) => (
              <div key={i} className="relative pl-8 md:pl-12">
                <div className={`absolute -left-[17px] top-1 w-8 h-8 rounded-full ${moment.bg} border-2 ${moment.border} flex items-center justify-center shadow-sm`}>
                  <moment.icon className={`w-3.5 h-3.5 ${moment.color}`} />
                </div>
                <div className="bg-[#FAFAF9] border border-[#E7E5E4] rounded-xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <span className="text-xs font-bold text-[#A8A29E] tracking-wider uppercase mb-1 block">{moment.time}</span>
                  <h3 className="font-serif text-xl text-[#292524]">{moment.title}</h3>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. FAQ Section (III) */}
      <section className="py-24 px-6 bg-[#FFFBF5]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-4xl text-[#292524] mb-4">Questions people ask</h2>
            <div className="w-16 h-0.5 bg-[#C2410C] mx-auto rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
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
              <div key={i} className="bg-white p-6 md:p-8 rounded-2xl border border-[#E7E5E4] shadow-sm hover:border-[#FED7AA] transition-colors duration-300">
                <h3 className="font-serif text-lg text-[#292524] font-medium mb-3">{faq.q}</h3>
                <p className="text-[#78716C] leading-relaxed text-sm md:text-base">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. CTA Section */}
      <section className="py-32 px-6 bg-gradient-to-b from-[#FAFAF9] to-[#FFF7ED] border-t border-[#E7E5E4] overflow-hidden relative">
        {/* Decorative elements */}
        <div className="absolute top-1/2 left-10 w-64 h-64 bg-[#FB923C] opacity-5 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 right-10 w-64 h-64 bg-[#84CC16] opacity-5 rounded-full blur-3xl"></div>

        <div className="max-w-3xl mx-auto text-center relative z-10 flex flex-col items-center">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-br from-[#FFF7ED] via-[#FFEDD5] to-[#FB923C] orb-glow-small mb-8 flex items-center justify-center border border-[#FED7AA]/50">
             <div className="w-full h-full rounded-full bg-gradient-to-tr from-transparent to-white/40 absolute top-0 left-0" />
          </div>
          
          <h2 className="font-serif text-4xl md:text-5xl text-[#292524] mb-8 leading-tight">
            Ready to meet your new bestie?
          </h2>
          
          <button className="group relative inline-flex items-center justify-center gap-3 px-10 py-5 bg-[#C2410C] text-white text-lg font-medium rounded-xl shadow-[0_8px_20px_-6px_rgba(194,65,12,0.4)] hover:bg-[#9A3412] hover:shadow-[0_12px_25px_-8px_rgba(194,65,12,0.5)] transition-all duration-300 hover:-translate-y-0.5">
            Meet Zee
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />
          </button>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="bg-[#292524] text-[#D6D3D1] py-16 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center md:items-start gap-12">
          <div className="flex flex-col items-center md:items-start">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#EA580C] to-[#FDBA74]" />
              <span className="font-serif text-2xl font-semibold text-white tracking-tight">ZeeMe</span>
            </div>
            <p className="text-[#A8A29E] text-sm text-center md:text-left max-w-xs">
              Your multimodal AI companion for continuous connection.
            </p>
          </div>

          <div className="flex flex-col md:flex-row gap-12 md:gap-24 text-center md:text-left">
            <div>
              <h4 className="text-white font-medium mb-4 uppercase text-xs tracking-wider">Company</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="#" className="hover:text-white transition-colors duration-200">About us</a></li>
                <li><a href="#" className="hover:text-white transition-colors duration-200">Blog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-medium mb-4 uppercase text-xs tracking-wider">Legal</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="#" className="hover:text-white transition-colors duration-200">Terms of Service</a></li>
                <li><a href="#" className="hover:text-white transition-colors duration-200">Privacy Policy</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-16 pt-8 border-t border-[#44403C] text-center md:text-left flex flex-col md:flex-row justify-between items-center text-sm text-[#A8A29E]">
          <p>© 2026 ZeeMe</p>
          <div className="mt-4 md:mt-0 flex gap-4">
            <span className="opacity-50">Designed for real life</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default SunlitStudio;
