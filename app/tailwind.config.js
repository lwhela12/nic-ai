/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#faf8f6',
          100: '#f3efe9',
          200: '#e5ddd3',
          300: '#d1c4b4',
          400: '#a89279',
          500: '#7d6654',
          600: '#5e4b3b',
          700: '#4a3a2e',
          800: '#352a21',
          900: '#231c16',
          950: '#150f0a',
        },
        accent: {
          50: '#f3f8f0',
          100: '#e1eeda',
          200: '#c3ddb6',
          300: '#9ec48b',
          400: '#7aad63',
          500: '#5a9341',
          600: '#467832',
          700: '#375f28',
          800: '#2c4c22',
          900: '#213a1a',
        },
        surface: {
          50: '#fdfcfa',
          100: '#f7f4ef',
          200: '#ede8e0',
          300: '#ddd5c9',
          400: '#b5aa9a',
        },
      },
      fontFamily: {
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgb(35 28 22 / 0.04), 0 1px 3px 0 rgb(35 28 22 / 0.06)',
        'card': '0 1px 3px 0 rgb(35 28 22 / 0.05), 0 2px 8px 0 rgb(35 28 22 / 0.05)',
        'elevated': '0 4px 6px -1px rgb(35 28 22 / 0.06), 0 10px 15px -3px rgb(35 28 22 / 0.10)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
