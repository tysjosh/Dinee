"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Header } from "@/components/ui/Header";

/**
 * Voice frequency animation component that displays animated bars
 * representing voice frequency patterns at the bottom of the page
 */
const VoiceFrequencyAnimation = () => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  const generateSmoothBars = () => {
    const colors = [
      "#64748b", // gray
      "#06b6d4", // cyan
      "#8b5cf6", // purple
      "#f59e0b", // amber
      "#10b981", // emerald
      "#ef4444", // red
      "#3b82f6", // blue
      "#f97316", // orange
    ];

    const totalBars = 120;
    const bars = [];

    for (let i = 0; i < totalBars; i++) {
      // Create smooth wave patterns using sine functions
      const wavePosition = (i / totalBars) * Math.PI * 4; // 4 complete waves across the width
      const baseWave = Math.sin(wavePosition) * 30 + 50; // Base wave pattern
      const secondaryWave = Math.sin(wavePosition * 2.5 + Math.PI / 3) * 20; // Secondary wave for complexity
      const tertiaryWave = Math.sin(wavePosition * 0.8 + Math.PI / 6) * 15; // Tertiary wave for more natural feel

      const baseHeight = Math.max(20, baseWave + secondaryWave + tertiaryWave);

      // Color selection based on position for gradient-like effect
      const colorIndex = Math.floor((i / totalBars) * colors.length);
      const color = colors[colorIndex % colors.length];

      bars.push(
        <motion.div
          key={i}
          className="rounded-t-full flex-1 min-w-0"
          style={{
            backgroundColor: color,
            minWidth: "2px",
          }}
          animate={{
            height: [
              baseHeight,
              baseHeight + Math.sin(i * 0.1 + Date.now() * 0.001) * 40,
              baseHeight + Math.sin(i * 0.15 + Date.now() * 0.002) * 60,
              baseHeight + Math.sin(i * 0.08 + Date.now() * 0.0015) * 35,
              baseHeight,
            ],
          }}
          transition={{
            duration: 3 + (i % 10) * 0.1, // Slightly varied duration for natural feel
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut",
          }}
          initial={{
            height: baseHeight,
            opacity: 0,
          }}
          whileInView={{
            opacity: 1,
          }}
        />
      );
    }

    return bars;
  };

  // Show invisible placeholder during SSR to prevent layout shift
  if (!isMounted) {
    return (
      <div className="absolute bottom-0 left-0 right-0 h-48 px-4 pb-4 z-20 opacity-0">
        <div className="w-full h-full" />
      </div>
    );
  }

  return (
    <motion.div
      className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-1 h-48 px-4 pb-4 z-20"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {generateSmoothBars()}
    </motion.div>
  );
};

/**
 * Homepage component that displays the main landing page
 * Features animated voice frequency bars and call-to-action
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleGetStarted = () => {
    router.push("/client/onboarding");
  };

  return (
    <div className="h-screen text-white overflow-hidden relative">
      <Header onTryNow={handleGetStarted} />
      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 pt-16 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold mb-2 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent font-display leading-tight">
            Voice AI agents
          </h1>
          <h2 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent font-display leading-tight">
            for your business
          </h2>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="text-gray-400 text-center max-w-2xl text-base md:text-lg leading-relaxed mb-8 px-4"
        >
          Automate your business phone calls with intelligent AI agents that
          understand your services, handle inquiries accurately, and integrate
          seamlessly with your operations.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.2, ease: "easeOut" }}
        >
          <button
            className="btn-try-now bg-emerald-500 text-black px-8 md:px-10 py-3 md:py-4 rounded-full text-base md:text-lg border-2 border-emerald-400 font-mono cursor-pointer shadow-button-inset-shadow"
            onClick={handleGetStarted}
          >
            <span className="flex items-center gap-3">
              Try Now
              <span className="relative flex size-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-black opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-black" />
              </span>
            </span>
          </button>
        </motion.div>
      </div>

      <VoiceFrequencyAnimation />
    </div>
  );
}
