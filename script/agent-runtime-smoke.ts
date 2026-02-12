import assert from "node:assert/strict";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:5432/my_ai_companion_local";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
}
if (!process.env.ENABLE_AGENT_MODEL_GAME_GENERATOR) {
  process.env.ENABLE_AGENT_MODEL_GAME_GENERATOR = "false";
}

async function run(): Promise<void> {
  const {
    classifyChatTurnIntent,
    checkPromptSpecificGameRequirements,
    inferAgentTaskKind,
    inferTaskRiskLevel,
    selectPreferredGameProjectFormat,
  } = await import("../server/agent-runtime.ts");

  assert.equal(
    classifyChatTurnIntent("I had a rough day today"),
    "companion_reply",
    "Casual conversation should stay in companion lane",
  );

  assert.equal(
    classifyChatTurnIntent(
      "Can you create a mini game from this drawing for us to play?",
    ),
    "agent_task",
    "Action + deliverable should route to agent lane",
  );

  assert.equal(
    classifyChatTurnIntent("Write a meeting brief and send it by email to my team"),
    "agent_task",
    "External send action with deliverable should route to agent lane",
  );

  assert.equal(
    classifyChatTurnIntent("Can you connect to my TV and lower the volume for me?"),
    "agent_task",
    "Device-control requests should route to agent lane",
  );

  assert.equal(
    classifyChatTurnIntent("I need to control my emotions today"),
    "companion_reply",
    "Emotional conversation should stay in companion lane",
  );

  assert.equal(
    classifyChatTurnIntent("can you create a new one?"),
    "companion_reply",
    "Ambiguous requests without context should stay in companion lane",
  );

  assert.equal(
    classifyChatTurnIntent("can you create a new one?", {
      hasRecentAgentActivity: true,
      recentTaskKind: "mini_game",
    }),
    "agent_task",
    "Follow-up requests should route to agent lane when recent task context exists",
  );

  assert.equal(
    classifyChatTurnIntent("make it harder", {
      hasRecentAgentActivity: true,
      recentTaskKind: "mini_game",
    }),
    "agent_task",
    "Mini-game tuning follow-ups should route to agent lane with context",
  );

  assert.equal(
    classifyChatTurnIntent(
      "can you make us something we can play together, snake style but faster with neon obstacles?",
    ),
    "agent_task",
    "Playable follow-up phrasing should route to agent lane without requiring the word game",
  );

  assert.equal(
    inferAgentTaskKind("make a game and a doc for class", true),
    "mixed",
    "Game + doc prompts should map to mixed task",
  );

  assert.equal(
    inferAgentTaskKind("write a project brief", false),
    "doc_markdown",
    "Doc prompts should map to doc artifact",
  );

  assert.equal(
    inferAgentTaskKind(
      "can you make us another snake one but faster, neon, and with obstacles?",
      false,
    ),
    "mini_game",
    "Snake follow-up phrasing should map to mini-game task kind",
  );

  assert.equal(
    inferAgentTaskKind("can you create another one please?", false, {
      hasRecentAgentActivity: true,
      recentTaskKind: "mini_game",
    }),
    "mini_game",
    "Contextual follow-up should stay in mini-game task kind",
  );

  assert.equal(
    inferTaskRiskLevel("please send this by email to my team"),
    "high",
    "External actions should be high risk",
  );

  assert.equal(
    inferTaskRiskLevel("build a small game prototype"),
    "low",
    "Sandboxed build-only tasks should be low risk",
  );

  assert.equal(
    inferTaskRiskLevel("I need to control my emotions today"),
    "low",
    "Non-device control language should remain low risk",
  );

  assert.equal(
    selectPreferredGameProjectFormat("build a quick tap mini game for us"),
    "single_file",
    "Simple casual requests should default to single-file generation",
  );

  assert.equal(
    selectPreferredGameProjectFormat(
      "Create a multi-scene 3D mini game with orbit movement and level progression",
    ),
    "multi_file",
    "Complex/3D prompts should prefer multi-file generation",
  );

  const snakePrompt =
    "create a snake game with arrow-key controls, obstacles, food pellets, growing body segments, and game-over on self collision and wall collision";
  const snakeHtml = `
<!doctype html>
<html>
  <body>
    <canvas id="game"></canvas>
    <script>
      const snake = [{ x: 5, y: 5 }];
      let direction = "right";
      let food = { x: 8, y: 5 };
      const obstacles = [{ x: 12, y: 8 }, { x: 12, y: 9 }];
      function tick() {
        const head = snake[0];
        const next = { x: head.x + 1, y: head.y };
        if (next.x < 0 || next.x >= 20) {
          console.log("wall collision");
        }
        const obstacleCollision = obstacles.some(
          (cell) => cell.x === next.x && cell.y === next.y
        );
        if (obstacleCollision) {
          console.log("obstacle collision");
        }
        const selfCollision = snake.some((segment) => segment.x === next.x && segment.y === next.y);
        if (selfCollision) {
          console.log("self collision");
        }
        snake.unshift(next);
        if (next.x === food.x && next.y === food.y) {
          food = { x: 2, y: 3 };
        } else {
          snake.pop();
        }
      }
      window.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp") direction = "up";
      });
    </script>
    <p>Use arrow keys. Avoid obstacles and collect food pellets.</p>
  </body>
</html>
`;

  assert.deepEqual(
    checkPromptSpecificGameRequirements({ prompt: snakePrompt, html: snakeHtml }),
    { ok: true },
    "Snake prompts should pass only when core snake mechanics are present",
  );

  const fakeSnakeHtml = `
<!doctype html>
<html>
  <body>
    <h1>Neon Snake Challenge</h1>
    <canvas id="game"></canvas>
    <script>
      const player = { x: 10, y: 10 };
      const hearts = [{ x: 1, y: 1 }, { x: 4, y: 8 }];
      function tick() {
        player.x += 1;
      }
    </script>
    <p>Catch hearts and dodge sparkles.</p>
  </body>
</html>
`;
  const fakeSnakeResult = checkPromptSpecificGameRequirements({
    prompt: snakePrompt,
    html: fakeSnakeHtml,
  });
  assert.equal(
    fakeSnakeResult.ok,
    false,
    "Snake prompts should fail QA when generator drifts to non-snake gameplay",
  );
  if (!fakeSnakeResult.ok) {
    assert.ok(
      fakeSnakeResult.missingSignals.length > 0,
      "Failed snake QA should include missing mechanics diagnostics",
    );
  }

  const neonSnakePrompt =
    "make a faster neon snake game with obstacles, arrow controls, food pellets, and self collision";
  const plainSnakeHtml = `
<!doctype html>
<html>
  <body>
    <canvas id="game"></canvas>
    <script>
      const snake = [{ x: 6, y: 6 }, { x: 5, y: 6 }];
      let tickMs = 140;
      let direction = { x: 1, y: 0 };
      let nextDirection = { x: 1, y: 0 };
      let food = { x: 2, y: 3 };
      function tick() {
        direction = nextDirection;
        const next = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
        if (next.x < 0 || next.x >= 20 || next.y < 0 || next.y >= 20) {
          console.log("wall collision");
        }
        const selfCollision = snake.some(
          (segment) => segment.x === next.x && segment.y === next.y
        );
        if (selfCollision) {
          console.log("self collision");
        }
        snake.unshift(next);
        if (next.x === food.x && next.y === food.y) {
          food = { x: 7, y: 4 };
        } else {
          snake.pop();
        }
      }
      window.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") nextDirection = { x: 1, y: 0 };
      });
    </script>
    <p>Classic snake mode.</p>
  </body>
</html>
`;
  const themedConstraintResult = checkPromptSpecificGameRequirements({
    prompt: neonSnakePrompt,
    html: plainSnakeHtml,
  });
  assert.equal(
    themedConstraintResult.ok,
    false,
    "Neon/faster/obstacle prompts should fail when those explicit mechanics/theme signals are missing",
  );
  if (!themedConstraintResult.ok) {
    assert.ok(
      themedConstraintResult.missingSignals.includes("obstacle_logic"),
      "Missing obstacle mechanics should be surfaced in QA diagnostics",
    );
    assert.ok(
      themedConstraintResult.missingSignals.includes("speed_tuning"),
      "Missing speed tuning should be surfaced in QA diagnostics",
    );
    assert.ok(
      themedConstraintResult.missingSignals.includes("neon_theme"),
      "Missing neon theme should be surfaced in QA diagnostics",
    );
  }

  console.log("agent-runtime smoke checks passed");
}

void run();
