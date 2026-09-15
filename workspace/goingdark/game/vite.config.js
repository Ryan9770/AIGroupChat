import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0', // 동일 네트워크 기기(스마트폰 등) 접속 허용
    port: 5173,
    open: false,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
