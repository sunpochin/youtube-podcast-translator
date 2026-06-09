/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        spotify: {
          green: '#1DB954',
          dark: '#121212',
          card: '#181818',
          hover: '#282828',
          text: '#B3B3B3',
        }
      }
    },
  },
  plugins: [],
}
