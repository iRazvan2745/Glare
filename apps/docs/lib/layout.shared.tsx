import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const gitConfig = {
  user: 'irazz',
  repo: 'glare',
  branch: 'main'
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Glare',
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
