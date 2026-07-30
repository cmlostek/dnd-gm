-- =============================================
-- Structured payload on chat messages.
-- =============================================
-- Dice rolls posted to chat need to render as a result card (shape, total,
-- breakdown, crit state), not as a string someone has to re-parse. A nullable
-- jsonb keeps plain messages exactly as they are today while giving richer
-- message kinds somewhere to live.
--
-- Shape for rolls:
--   { "kind": "roll", "label": "Longsword attack", "detail": "[14] + 3",
--     "total": 17, "die": 20, "crit": "hit" }

alter table chat_messages add column if not exists data jsonb;
