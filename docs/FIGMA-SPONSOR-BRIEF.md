# Figma — Idea To Demo

**Event:** Cal Hacks 13.0

**Source:** Sponsor context supplied by the project owner. The brief below preserves the supplied wording with Markdown formatting. No source URL or example link was supplied.

**Status:** Requirements and planning context; this document does not claim any deliverable is complete.

## Sponsor brief

### Context

Every team builds differently. Some start in a design tool, some start in code, and many bounce between the two. Figma now offers more than a canvas: Make can turn a prompt into a working prototype, and Figma agent can read and write designs and pass them to code.

This challenge is about building a real project the way you normally would, then showing us where each tool fits in your process.

### Your Mission

Take an idea to a working demo within the hackathon. Use any mix of tools you like. Figma’s tools and agent capabilities are available to you, and you decide at which stages they earn a place.

Projects might include:

- A web or mobile app built from a rough idea
- A redesign of software that frustrates you, delivered as a working demo
- A tool you’ve wanted for your own workflow
- Anything else you can take from idea to demo in the time given

You’ll submit the demo plus a short stage log (workflow artifact) recording which tools you used at each step of the build.

### Considerations

Build what you were already going to build. Your project can be ambitious or modest, and we’re not judging on scope or technical difficulty. We care most about a clear problem, an honest account of how you built it and a demo that works.

Strong submissions show intentional tool choices: why each tool was used at each stage and what got passed from one stage to the next.

Your real process probably isn’t a straight line from design to code. You might start in code, jump to a prototype halfway, or loop back to ideation after testing with a friend. Show the path you actually took and how you used Figma’s tools to iterate.

### Submission Requirements

Please make sure your Figma files are accessible to “Anyone”.

Final submission should consist of three deliverables:

- Demo video (3 minutes maximum)
- Workflow Artifact / Stage Log (200 words max per stage)
- Figma Slides demonstrating your work & workflow (required)

[Stage log] State which Figma product you used & why.

Example here — feel free to edit and add on as needed

[Demo Video] Showcase your build in a quick demo

[Working Code & Prototype] Must embed your Figma files (Make(s) and/or Figma prototypes) showcasing how you used Figma and a link to your working code/repository.

Make sure you are Edu verified

The stage log covers four stages, and you may explain the stages you used Figma in:

| Stage | Description |
| --- | --- |
| Ideation | Exploring and shaping the idea |
| Prototyping | Making something you could click through or try |
| Handoff | Moving a design or spec toward implementation |
| Code generation | Producing the working code |

For each stage, tell us:

- Which Figma tool(s) you used (Figma Design, Make, a Figma agent, etc.) & why
- About how many minutes you spent
- How well it worked, from 1 to 5
- How the output made it into your final project

### Additional Info

What makes a good workflow?

- Intentional: Each tool is there for a reason, not because it was required.
- Traceable: We can see where an idea turned into a design, and where a design turned into code.
- Honest about friction: The log notes rework, dead ends, and tools you abandoned.
- Reusable: Another team could run a similar process on a different idea.

## GhostLoop application and ownership

This section is the team's interpretation and implementation plan, separate from the sponsor's wording above.

The brief emphasizes the actual process used to build GhostLoop. It does not state that Figma must be used in every stage or integrated into the running product. Record stages without Figma honestly; use N/A for a Figma rating where appropriate. Do not manufacture a design-first sequence or claim a tool generated code when it did not.

GhostLoop's editable candidate variants, version mappings, and correspondence checks remain product requirements in the [PRD](PROJECT-PRD.md) and issue #3. They go beyond this sponsor brief. Automated Figma writing is not a sponsor requirement; the existing supported designer-triggered variant fallback remains valid for the product when its correspondence checks pass.

| Owner | Contribution |
| --- | --- |
| A — [#1](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/1) | Coordinate submission assembly: stage log, Figma Slides, video, embedded Figma artifacts, repository link, and final access/Edu checks. Collect contributions from all teammates; maintain links in the demo runbook. |
| B — [#2](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/2) | Supply genuine trace/replay evidence and document testing that actually informed development iterations. Distinguish live execution, recorded runs, and fixtures. |
| C — [#3](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/3) | Supply Figma files/prototypes and actual design-to-code or code-to-design handoffs, tool choices, time, ratings, and friction. Prepare working embeds and verify “Anyone” access with A. |
| D — [#4](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/4) | Supply version/patch/approval/run/evaluation references supporting the demo and any development iterations. Record actual tool use; no additional Figma backend integration or stage-log database feature is required by this brief. |

A owns assembling `docs/figma-stage-log.md` and linking final submission artifacts from `docs/demo-runbook.md`; these are planned deliverables. Every teammate supplies their own accurate entries. The stage log describes the team's build process, while experiment records describe GhostLoop's runtime behavior. Runtime records can support the log, but do not replace it.

### Stage-log entry template

Use one entry for each of Ideation, Prototyping, Handoff, and Code generation, with at most 200 words per stage. Mention repeat visits within the relevant stage and preserve the real order of events.

- **Tools and why:** Name the Figma product(s) actually used and relevant other tools; explicitly note when Figma was not used.
- **Approximate minutes:** Record actual or honestly estimated time.
- **Rating:** 1–5 for the Figma tool experience, or N/A if unused.
- **Input → output → final project:** Identify the artifact received, produced, and consumed, with file/frame/commit links where available.
- **Friction and iteration:** Note rework, abandoned approaches, manual steps, and what another team would need to repeat the process.

### Submission checklist

- [ ] Demo video is at most 3 minutes and shows the working build.
- [ ] Stage log covers the four stages, stays within 200 words per stage, and records tools/reasons, minutes, ratings, and outputs honestly.
- [ ] Required Figma Slides show both the work and the actual workflow.
- [ ] Working Code & Prototype submission includes embedded Figma Make(s) and/or prototypes plus a working code/repository link.
- [ ] Submitted Figma files are accessible to “Anyone”; A/C verify the reviewer view and embeds.
- [x] Edu verification is confirmed before submission.
- [ ] Final artifact links are collected in the demo runbook, with live runs, recorded real evidence, and fixtures clearly distinguished.
