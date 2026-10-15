import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [{ ignores: ['coverage/**', '.crash-e2e/**'] }, ...nextCoreWebVitals];

export default config;
