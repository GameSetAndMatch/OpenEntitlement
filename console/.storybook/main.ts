import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../web/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  async viteFinal(config) {
    config.resolve ??= {};
    config.resolve.conditions = ['source', ...(config.resolve.conditions ?? [])];
    return config;
  },
};
export default config;
