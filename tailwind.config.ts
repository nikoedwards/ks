import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ks: {
          green: '#05CE78',
          'green-dark': '#04a862',
          'green-light': '#e8fdf4',
        },
      },
    },
  },
  plugins: [],
};

export default config;
