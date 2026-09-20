<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Standing project rule

This initial design is the one allowed Lovable build prompt. Never use follow-up Lovable build/edit prompts for design, UI, data, logic, integrations, or fixes unless Aryeh explicitly authorizes an exception. All subsequent changes must be implemented through the connected GitHub repository.

## Product direction

The app is a player research and fantasy decision hub. Keep model-development progress, backtest summaries, and project status updates in chat, not in app navigation or landing pages. Player-specific projection explanations and uncertainty are appropriate in the app. Do not fabricate rankings or forecasts to fill missing data.
