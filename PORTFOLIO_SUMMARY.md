# Portfolio Summary

## One-Sentence Version

`youtube-podcast-translator` is an automated media translation and publishing pipeline that transcribes YouTube audio, runs domain-specific bilingual translation using local Ollama models (with Gemini fallback), and pushes formatted summaries and transcriptions to GitBook via GitOps.

---

## Short Blurb

Built an automated, self-contained podcast translation service leveraging local LLMs (Qwen 2.5) to translate and format YouTube subtitles under strict social dance terminology constraints, deploying pages directly to a static GitBook instance and integrating with a companion social sharing microservice.

---

## Resume Bullets

- Built an automated transcription-to-publishing pipeline translating YouTube podcasts to GitBook pages with local Ollama (`qwen2.5:7b`/`qwen2.5:14b`) and cloud Gemini fallbacks.
- Authored a project-local Agentic Workflow specification (Agent Skills) to standardize LLM terminology alignment (e.g. Salsa, Bachata) and GitBook liquid embed parsing rules.
- Designed a custom Node.js CLI publishing helper protecting hand-written documentation from AI overwrites via cryptographic-signature markers and directory traversal checks.
- Integrated asynchronous job dispatch and polling verification between the translator core and a companion social media microservice to automate social sharing.

---

## How To Present It

Present this repo as:

> a specialized AI-assisted content translation and publishing pipeline with repository-controlled agent guardrails

not as:

> a generic transcription API wrapper or basic script
