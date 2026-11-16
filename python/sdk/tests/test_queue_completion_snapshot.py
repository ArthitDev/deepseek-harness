"""Project queued turn completion through the real Python SDK runtime."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / 'apps' / 'cli' / 'lib' / 'bin.js'
SCENARIO = ROOT / 'snapshots' / 'sdk' / 'queued-turn-completion'


@pytest.mark.skipif(not CLI.exists(), reason='requires the built dsh profile runtime')
def test_queue_completion_snapshot(tmp_path: Path) -> None:
    node = shutil.which('node')
    assert node is not None, 'requires Node.js to launch the built dsh CLI'
    provider = 'queue-completion-replay'
    patch = tmp_path / 'replay.patch.json'
    patch.write_text(json.dumps([{'insert': [
        {
            'id': 'queue-completion-replay',
            'name': (ROOT / 'packages/test-support/llm-replay/lib/index.js').as_uri(),
            'config': {
                'file': str(SCENARIO / 'session.v5.jsonl'),
                'providers': [{'id': provider, 'models': [{'id': 'deepseek-v4-flash'}]}],
            },
        },
        {'id': 'queued-turn-completion-fixture', 'name': (SCENARIO / 'queue-fixture.mjs').as_uri()},
    ]}]), encoding='utf-8')
    # Windows cannot execute the CLI's JavaScript shebang directly.
    with DeepSeekHarness(
        _launch_args=(node, str(CLI), '--profile', 'sdk', '--patch', str(patch)),
        cwd=str(tmp_path),
        provider=provider,
        model='deepseek-v4-flash',
        env={
            'DSH_HOME': str(tmp_path / 'home'),
            'DSH_TELEMETRY_DISABLED': '1',
            'DSH_SNAPSHOT': 'replay',
            'DEEPSEEK_API_KEY': '',
        },
    ) as harness:
        result = harness.run('Reply with exactly the word: ONE. No tools.')
    actual = {
        'final_response': result.final_response,
        'finish_reason': result.finish_reason,
        'turns': [event['data'] for event in result.events if event['type'] == 'turn/end'],
    }
    expected = Path(__file__).with_name('expected') / 'queue-completion.json'
    assert actual == json.loads(expected.read_text())
