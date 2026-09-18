// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import EnvironmentIcon, { minecraftIconType } from './EnvironmentIcon';
import { loaders } from '../shared/types';

afterEach(cleanup);

it.each(['1.20.1', '26.1', 'custom-build', ''])('defaults %s to the release icon', version => {
  expect(minecraftIconType(version)).toBe('release');
});

it.each(['24w14a', '25w14craftmine', '26.1-snapshot-10', '1.21-pre1', '1.21-rc1', '26.1-pre-3', '26.1-rc-1', '1.20 Pre-Release 1', '1.20 Release Candidate 1'])('recognizes %s without online metadata', version => {
  expect(minecraftIconType(version, null)).toBe('snapshot');
});

it('prefers authoritative metadata and updates the rendered game icon', () => {
  expect(minecraftIconType('custom-build', 'snapshot')).toBe('snapshot');
  expect(minecraftIconType('24w14a', 'release')).toBe('release');
  const view = render(<EnvironmentIcon kind="minecraft" version="1.20.1" versionType="release" />);
  expect(view.container.querySelector('img')).toHaveAttribute('src', '/icons/minecraft-release.png');
  view.rerender(<EnvironmentIcon kind="minecraft" version="custom-build" versionType="snapshot" />);
  expect(view.container.querySelector('img')).toHaveAttribute('src', '/icons/minecraft-snapshot.png');
});

it.each(loaders)('uses the official local %s image without duplicating the adjacent text', loader => {
  const view = render(<EnvironmentIcon kind="loader" loader={loader} version={null} />);
  const extension = loader === 'quilt' ? 'svg' : 'png';
  expect(view.container.querySelector('img')).toHaveAttribute('src', `/icons/${loader}.${extension}`);
  expect(view.container.querySelector('img')).toHaveAttribute('alt', '');
  expect(view.container.firstChild).toHaveAttribute('aria-hidden', 'true');
});

it('keeps a fallback until configuration changes, then retries even when the image URL is unchanged', () => {
  const view = render(<EnvironmentIcon kind="loader" loader="fabric" version="0.15.1" />);
  fireEvent.error(view.container.querySelector('img')!);
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.querySelector('svg')).toBeInTheDocument();
  view.rerender(<EnvironmentIcon kind="loader" loader="fabric" version="0.15.1" />);
  expect(view.container.querySelector('img')).toBeNull();
  view.rerender(<EnvironmentIcon kind="loader" loader="fabric" version="0.16.0" />);
  expect(view.container.querySelector('img')).toHaveAttribute('src', '/icons/fabric.png');
  fireEvent.error(view.container.querySelector('img')!);
  view.rerender(<EnvironmentIcon kind="loader" loader="quilt" version={null} />);
  expect(view.container.querySelector('img')).toHaveAttribute('src', '/icons/quilt.svg');
});
