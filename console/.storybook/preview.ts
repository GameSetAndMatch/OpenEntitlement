import type { Preview } from '@storybook/react-vite';
import '../web/src/style.css';
import '../web/src/workspace/style.css';
const preview: Preview = { parameters: { layout: 'padded', a11y: { test: 'error' } } };
export default preview;
