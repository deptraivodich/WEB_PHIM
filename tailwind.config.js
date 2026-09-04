/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#09090b', // OLED Dark Black
        surface: '#121217',
        'surface-card': '#181820',
        'neon-red': '#e50914',
        'neon-red-glow': '#ff2e3b',
        'neon-cyan': '#00f0ff',
        'glass': 'rgba(18, 18, 23, 0.75)',
        'glass-border': 'rgba(255, 255, 255, 0.08)',
      },
      boxShadow: {
        'neon-red': '0 0 20px rgba(229, 9, 20, 0.5), 0 0 40px rgba(229, 9, 20, 0.2)',
        'neon-cyan': '0 0 20px rgba(0, 240, 255, 0.5), 0 0 40px rgba(0, 240, 255, 0.2)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      backdropBlur: {
        'xs': '2px',
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: 1, filter: 'drop-shadow(0 0 15px rgba(229, 9, 20, 0.6))' },
          '50%': { opacity: 0.5, filter: 'drop-shadow(0 0 5px rgba(229, 9, 20, 0.2))' },
        }
      }
    },
  },
  plugins: [],
};
