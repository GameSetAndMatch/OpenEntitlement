import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://openentitlement.dev',
  trailingSlash: 'always',
  vite: { resolve: { alias: [
    { find: '@openentitlement/core/authoring', replacement: new URL('../sdk-js/packages/core/src/authoring.ts', import.meta.url).pathname },
    { find: /^@openentitlement\/core$/, replacement: new URL('../sdk-js/packages/core/src/index.ts', import.meta.url).pathname },
  ] } },
  integrations: [react(), starlight({
    title: 'OpenEntitlement',
    description: 'An open-source entitlement service and protocol. Learn to resolve what an organization may do, and how much of it.',
    logo: { light: './public/logo.svg', dark: './public/logo-dark.svg', replacesTitle: false },
    favicon: '/favicon.svg',
    social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/open-entitlement/OpenEntitlement' }],
    customCss: ['./src/styles/docs.css'],
    components: { Head: './src/components/Head.astro' },
    editLink: { baseUrl: 'https://github.com/open-entitlement/OpenEntitlement/edit/main/website/src/content/docs/' },
    sidebar: [
      { label: 'Start here', items: [
        { label: 'Introduction', slug: 'docs' },
        { label: 'Quickstart', slug: 'docs/quickstart' },
        { label: 'Core concepts', slug: 'docs/concepts' },
        { label: 'Specification overview', slug: 'docs/specification' },
      ] },
      { label: 'Workspace', items: [
        { label: 'Privilege Catalog', slug: 'docs/privilege-catalog' },
        { label: 'Tiers', slug: 'docs/tiers' },
        { label: 'Organizations', slug: 'docs/organizations' },
      ] },
      { label: 'Guides', items: [
        { label: 'ACME Workspace walkthrough', slug: 'docs/acme-workspace' },
      ] },
      { label: 'Build with OpenEntitlement', items: [
        { label: 'Python SDK', slug: 'docs/python' },
        { label: 'TypeScript SDK', slug: 'docs/typescript' },
        { label: 'Self-host the service', slug: 'docs/self-hosting' },
        { label: 'Guards & usage', slug: 'docs/guards' },
      ] },
      { label: 'Reference', items: [
        { label: 'OEREP HTTP API', slug: 'docs/oerep' },
        { label: 'Implementing the contract', slug: 'docs/implementing' },
        { label: 'Glossary', slug: 'reference/glossary' },
        { label: 'Specification', items: [{ autogenerate: { directory: 'specification' } }] },
      ] },
      { label: 'Project', items: [
        { label: 'Architecture & scope', slug: 'docs/architecture' },
        { label: 'Contributing', slug: 'docs/contributing' },
        { label: 'Project status', slug: 'docs/project' },
      ] },
    ],
  })],
});
