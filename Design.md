# QueenBee DESKTOP — UI/UX DESIGN SYSTEM

Design the entire QueenBee desktop application using the following visual direction. Apply this consistently across every screen, component, dashboard, menu, panel, and interaction.

## 1. Overall Design Style

Create a premium, modern dark-mode desktop application with:

- Clean grid-based card layouts.
- Large central Project Activity Map.
- Minimal, organized navigation.
- Frosted-glass panels and floating overlays.
- Pixel-art characters representing real Claude Code agents.
- Subtle bee-inspired branding and colors.
- Professional developer-tool aesthetics.
- Smooth, responsive interactions.

The application should feel like a combination of a modern operating-system interface, an AI command centre, and a pixel-art virtual office.

Avoid generic SaaS dashboard designs.

## 2. Color Palette

Use a deep dark theme as the foundation.

**Main colors:**
- Background: #101216
- Card background: #181C22
- Elevated surfaces: #202630
- Borders: #303844
- Primary text: #F3F5F7
- Secondary text: #A3ADB9
- Muted text: #737E8B

**Bee-inspired brand colors:**
- Bee Yellow: #F2C94C
- Bee Amber: #D99B27
- Bee Black: #202124

Use bee yellow for branding, selected elements, important highlights, and Queen identity.

Do not make everything yellow.

**Semantic status colors:**
- Green (#36B879) = Safe / Healthy / Completed
- Yellow (#E8B44B) = Warning / Pending / Needs Attention
- Red (#E45B5B) = At Risk / Error / Critical
- Blue (#69A7E8) = Informational

Never use status colors randomly. Every color must communicate a consistent meaning.

## 3. Typography

Use Inter as the primary font, with system sans-serif fallbacks.

Typography should be clean, modern, and highly readable.

- Large page titles.
- Strong visual hierarchy.
- Clear section headings.
- Compact metadata.
- Highly visible important metrics.
- Tabular numbers for counters, durations, and timestamps.

Use different font sizes and weights to distinguish important information.

## 4. Dashboard Layout

Create a clean grid-based dashboard.

Main structure:

- Top navigation bar.
- Left sidebar.
- Large central Project Activity Map.
- Right floating Issues and Approvals panel.
- Bottom live activity strip.

The central Project Activity Map must be the main visual focus.

Secondary metrics, agent status cards, and notifications should not compete with it.

## 5. Central Project Activity Map

Create a large interactive visual workspace showing:

- Queen as the central coordinator.
- Worker agents.
- Agent work areas.
- Project modules.
- Task dependencies.
- Agent communication.
- Active tasks.
- Blocked tasks.
- Completed tasks.
- Collaboration relationships.

Allow users to select agents and tasks to inspect their details.

Use subtle grid patterns, contour-inspired lines, and clean connections.

This is a project activity map, not a geographic map.

All displayed activity must reflect real application state.

## 6. Frosted Glass / Backdrop Filtering

Use modern glassmorphism inspired by macOS and Windows Fluent Design.

Apply frosted-glass effects to:

- Issues panel.
- Approval panel.
- Agent detail windows.
- Floating menus.
- Notification panels.
- Context menus.
- Command palette.

Use:

- Semi-transparent dark backgrounds.
- Approximately 18–28px backdrop blur.
- Subtle translucent borders.
- Soft shadows.
- Rounded corners.
- Clear foreground/background separation.

Example CSS:

```css
.glass-panel {
  background: rgba(24, 28, 34, 0.78);
  backdrop-filter: blur(22px) saturate(125%);
  -webkit-backdrop-filter: blur(22px) saturate(125%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.32);
}
```

The background application should remain recognizable through floating panels without distracting from their content.

Do not apply heavy blur to every component. Preserve performance and readability.

## 7. Pixel-Art Characters

Use a consistent pixel-art visual style for Queen and all worker agents.

Characters should have:

- Distinct appearances.
- Small readable pixel details.
- Individual accessories or role indicators.
- Bee-inspired yellow accents.
- Consistent pixel scale.
- Professional, charming visual identity.

Queen should have a distinctive Queen Bee appearance.

Workers should have individual character designs.

Character states must reflect real agent activity:

- Working.
- Thinking.
- Idle.
- Waiting.
- Blocked.
- In a meeting.
- Completed.
- Paused.
- Error.

Animations must be connected to actual Claude Code session states.

Never display fake typing, fake progress, or fake agent activity.

Allow users to click characters to inspect their actual agent sessions.

## 8. Bee-Inspired Branding

Use a subtle bee visual identity throughout the application.

- Queen Bee represents the central orchestrator.
- Worker bees represent worker agents.
- Bee yellow is the primary brand accent.
- Black and charcoal provide contrast.
- Small honeycomb and hexagonal motifs may be used in backgrounds and icons.
- Use bee-inspired details without turning the entire application into a cartoon.

The final design must remain a premium professional developer application.

## 9. Cards and Components

Cards should have:

- Dark neutral backgrounds.
- Subtle borders.
- Consistent spacing.
- Rounded corners.
- Clear typography.
- Minimal shadows.
- Good information hierarchy.

Buttons:

- Primary actions: Bee yellow.
- Secondary actions: Neutral dark surfaces.
- Destructive actions: Red.
- Disabled actions: Muted neutral colors.

Status labels must use both text and color.

## 10. Issues and Approval Panel

Create a floating frosted-glass panel.

Display:

- Issue severity.
- Issue description.
- Affected agent.
- Evidence.
- Detection time.
- Current status.
- Available actions.

Make pending user approvals highly visible.

Critical issues must be distinguishable from ordinary informational messages.

## 11. Animation and Interaction

Use smooth, restrained animations.

Examples:

- Floating panel transitions.
- Agent character animations.
- Map node highlighting.
- Task state transitions.
- Notification appearance.
- Button interactions.
- Meeting-room transitions.

Avoid excessive motion.

Support reduced-motion preferences.

Animations must never misrepresent real application activity.

## 12. Consistency Requirements

Apply this design system to the entire application:

- Main dashboard.
- Queen interface.
- Agent management.
- Agent sessions.
- Animated office.
- Terminal views.
- Project explorer.
- Code intelligence.
- Skills management.
- Task management.
- Issues and alerts.
- Approval dialogs.
- Settings.
- Onboarding.

Do not create unrelated visual styles for different screens.

## 13. Final Design Direction

The final application should look:

- Premium.
- Modern.
- Dark.
- Intelligent.
- Minimal.
- Highly organized.
- Visually distinctive.
- Technically professional.
- Slightly playful through pixel-art characters.
- Recognizable through bee-inspired branding.

**Most important:** Prioritize usability, readability, visual hierarchy, and real-time agent visibility over decoration.

Follow this design system consistently. Do not introduce additional visual themes, colors, UI patterns, or unrelated design elements without my approval.