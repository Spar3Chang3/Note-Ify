# Note-Ify

### This is my personal discord bot that joins the GM's VC and automatically summarizes and game session

---

## HEADS UP

This bot is a work in progress, it is nothing special, and it heavily relies on my already integrated services. By all means fork and mess with it yourself, but be prepared to encounter spaghetti.

As of right now, the bot takes streams from a discord vc, transcribes them using whisper.cpp, and feeds the resulted text to an LLM through Ollama.

## BUILDING

I used bun for the sake of compiling a smaller binary, but node should work for standard runs with a bit of dependency care. The following instructions should help you with setting up the repo for bun. Just don't forget your own discord bot token.

`git clone https://github.com/Spar3Chang3/Note-Ify.git`
`cd Note-Ify`
`bun install`

For running directly:

`bun index.js`

For compiling:

`bun build index.js --compile --outfile noteify`
`chmod +x noteify`
`./noteify`
