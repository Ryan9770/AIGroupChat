import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Routes } from '../protocol/plan.js';
import { findRepoRoot } from '../workspace/git.js';

export const CONFIG_FILE = 'conductor.config.json';

/**
 * 대상 저장소의 설정 파일.
 *
 * 팀 구성(역할별 담당)을 한 번 정해두고 모든 계획에서 쓰기 위한 것이다.
 * 계획 파일의 `routes`가 이걸 덮어쓴다.
 */
export const ConductorConfig = z.object({
  routes: Routes.optional(),
  /** 실행 전체 비용 상한(USD). */
  budgetUsd: z.number().positive().optional(),
  /** Task 하나당 최대 시도 횟수(페일오버 포함). */
  maxAttempts: z.number().int().positive().optional(),
});
export type ConductorConfig = z.infer<typeof ConductorConfig>;

export interface LoadedConfig {
  config: ConductorConfig;
  /** 어디서 읽었는지. 없으면 undefined. */
  path?: string;
  /** 파일은 있었지만 형식이 틀린 경우의 설명. */
  problem?: string;
}

/**
 * 대상 디렉토리(또는 그 저장소 루트)에서 설정을 읽는다.
 *
 * 파일이 없으면 조용히 기본값을 쓴다. 형식이 틀리면 **조용히 넘기지 않고**
 * 문제를 돌려준다 — 설정을 썼는데 무시되면 왜 안 먹는지 알 수 없다.
 */
export async function loadConfig(cwd: string): Promise<LoadedConfig> {
  const roots = [cwd];
  const repoRoot = await findRepoRoot(cwd);
  if (repoRoot && repoRoot !== cwd) roots.push(repoRoot);

  for (const root of roots) {
    const path = join(root, CONFIG_FILE);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      return { config: {}, path, problem: `JSON 파싱 실패: ${(err as Error).message}` };
    }

    const parsed = ConductorConfig.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        config: {},
        path,
        problem: parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join(', '),
      };
    }
    return { config: parsed.data, path };
  }

  return { config: {} };
}
