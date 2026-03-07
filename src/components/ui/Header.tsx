"use client";

import React from "react";
import { motion } from "motion/react";
import { Poppins } from "next/font/google";
import Link from "next/link";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

interface HeaderProps {
  onTryNow?: () => void;
}

/**
 * Minimal header component used on onboarding pages
 * Shows only the logo with a clean, minimal design
 */
export const MinimalHeader: React.FC = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/20 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <Link
          href={"/client"}
          className={`text-xl font-semibold text-white ${poppins.className}`}
        >
          RECEP AI
        </Link>
      </div>
    </header>
  );
};

/**
 * Main header component with full navigation and branding
 * Used on the homepage and main application pages
 */
export const Header: React.FC<HeaderProps> = ({ onTryNow }) => {
  return (
    <motion.header
      className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-b border-gray-800 font-mono"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex-shrink-0">
            <Link
              href={"/client"}
              className={`text-2xl font-bold text-white ${poppins.className}`}
            >
              RECEP AI
            </Link>
          </div>

          <nav className="hidden md:flex items-center space-x-8">
            <a
              href="#"
              className="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium tracking-wide"
            >
              FEATURES
            </a>
            <a
              href="#"
              className="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium tracking-wide"
            >
              PRICING
            </a>
            <a
              href="#"
              className="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium tracking-wide"
            >
              ABOUT
            </a>
            <a
              href="#"
              className="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium tracking-wide"
            >
              RESOURCES
            </a>
            <a
              href="#"
              className="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium tracking-wide"
            >
              CONTACT US
            </a>
          </nav>

          <div className="flex-shrink-0 hidden md:block">
            <button
              className="btn-try-now border-2 border-emerald-400 bg-emerald-500 text-black px-6 py-2 rounded-full text-sm font-mono cursor-pointer shadow-button-inset-shadow-mini"
              onClick={onTryNow}
            >
              <span className="flex items-center gap-3 ">Try Now</span>
            </button>
          </div>

          <div className="md:hidden">
            <button className="text-gray-300 hover:text-white">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </motion.header>
  );
};
