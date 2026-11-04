import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://openentitlement.dev',
  trailingSlash: 'always',
  integrations: [starlight({
    title: 'OpenEntitlement',
    disable404Route: true,
    description: 'An open-source entitlement service and protocol. Learn to resolve what an organization may do, and how much of it.',
    logo: { src: './public/logo.svg', replacesTitle: false },
    favicon: '/favicon.svg',
    social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/GameSetAndMatch/openentitlement' }],
    customCss: ['./src/styles/docs.css'],
    editLink: { baseUrl: 'https://github.com/GameSetAndMatch/openentitlement/edit/main/website/' },
    sidebar: [
      { label: 'Start here', items: [
        { label: 'Introduction', slug: 'docs' },
        { label: 'Quickstart', slug: 'docs/quickstart' },
        { label: 'Core concepts', slug: 'docs/concepts' },
      ] },
      { label: 'Build with OpenEntitlement', items: [
        { label: 'TypeScript SDK', slug: 'docs/typescript' },
        { label: 'Python SDK', slug: 'docs/python' },
        { label: 'Self-host the service', slug: 'docs/self-hosting' },
        { label: 'Guards & usage', slug: 'docs/guards' },
      ] },
      { label: 'Reference', items: [
        { label: 'OEREP HTTP API', slug: 'docs/oerep' },
        { label: 'Glossary', slug: 'reference/glossary' },
        { label: 'Specification', items: [{ autogenerate: { directory: 'specification' } }] },
      ] },
      { label: 'Project', items: [
        { label: 'Architecture & scope', slug: 'docs/architecture' },
        { label: 'Contributing', slug: 'docs/contributing' },
        { label: 'Deploy this website', slug: 'docs/website' },
      ] },
    ],
  })],
});
