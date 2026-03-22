<p align="center">
  <img src="https://raw.githubusercontent.com/Spar3Chang3/Note-Ify/refs/heads/main/assets/noteify-logo.jpg" alt="Note-Ify logo" width="220" />
</p>

<h1 align="center">Note-Ify</h1>

<p align="center">
  A personal Discord bot that joins your GM's voice channel, transcribes the session, and turns the chaos into usable summaries.
</p>

---

## What is Note-Ify?

**Note-Ify** is a personal Discord bot built for tabletop sessions. It joins the GM's voice chat, captures the conversation, transcribes it with **whisper.cpp**, and sends the resulting text to an LLM through **Ollama** so your session can be summarized automatically.

The project is still a work in progress, but it already supports a configurable setup through `conf/conf.toml`, making it easier to swap models, adjust endpoints, and tune the bot to your own environment.

## Heads up

This project is very much a personal tool first.

It works, but it is still evolving, and parts of it are tightly coupled to services I already use in my own setup. You're absolutely welcome to fork it, break it, rebuild it, and make it your own — just expect some spaghetti along the way.

## Features

- Joins a Discord voice channel for live session capture
- Transcribes speech using **whisper.cpp**
- Summarizes transcriptions with an LLM through **Ollama**
- Uses a configurable `conf/conf.toml` file for models, endpoints, and runtime settings
- Can be run directly or compiled into a smaller binary with **Bun**

## Requirements

Before you start, make sure you have:

- **Bun** installed
- A **Discord bot token**
- A working **whisper.cpp** setup
- **Ollama** installed and running with a compatible model

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Spar3Chang3/Note-Ify.git
cd Note-Ify
````

### 2. Install dependencies

```bash
bun install
```

### 3. Add your Discord token

You can provide your token in either of these ways:

#### Option A: `.env` file

Create a `.env` file next to `App.js`:

```env
DISCORD_TOKEN=your-token-here
```

#### Option B: `conf/conf.toml`

Open `conf/conf.toml` and set:

```toml
discord_token = "your-token-here"
```

## Running the bot

Run it directly with Bun:

```bash
bun App.js
```

## Compiling a binary

If you want a compiled executable, use:

```bash
bun build App.js --compile --outfile noteify
chmod +x noteify
./noteify
```

## Why Bun?

I used **Bun** mainly because it produces a smaller compiled binary and keeps the setup simple for this project.

Running with Node is possible, but it may require different imports and extra package adjustments in the app entry files. I do not currently plan to maintain separate Node setup instructions, so **Bun is the recommended path**.

## Configuration

Most of the important runtime settings live in:

```text
conf/conf.toml
```

That file is intended to make setup easier by letting you adjust things like:

* Discord token
* whisper.cpp endpoint or model path
* Ollama model selection
* Other project-specific options as they are added

## Current state

Note-Ify is functional, but still under active development. Expect rough edges, changing behavior, and the occasional weird decision that made sense at 2 AM.

## Need help?

If you're a GM looking for something like this but have no idea where to begin, breathe. You're already juggling enough without also having to debug bots between initiative rolls and whatever Ragnar III is doing to that poor bartender.

I plan to make a full step-by-step tutorial covering:

* Installing Ollama
* Setting up whisper.cpp
* Creating a Discord bot
* Configuring this repository
* Running your first session with Note-Ify

## Tutorial

**Coming soon.** I’ll put together a proper walkthrough as soon as I can.

## Contributing

If you want to poke around, fork the repo, or clean up the spaghetti, go for it. Improvements, fixes, and experiments are all fair game.
