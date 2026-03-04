# Note-Ify

### This is my personal discord bot that joins the GM's VC and automatically summarizes and game session

---

## HEADS UP

This bot is a work in progress, it is nothing special, and it heavily relies on my already integrated services. By all means fork and mess with it yourself, but be prepared to encounter spaghetti.

As of right now, the bot takes streams from a discord vc, transcribes them using whisper.cpp, and feeds the resulted text to an LLM through Ollama. I've now included a `config.toml` file that should easily let you control models, whisper.cpp endpoints, and a few other things.

## BUILDING

I used bun for the sake of compiling a smaller binary. Using Node is possible, but you will need other package dependencies and imports within `index.js`. I do not plan to give node setup instructions, so I highly recommend just sticking with bun. The following instructions should help you with setting up the repo, just don't forget your discord token. It can either be added with:

* A `.env` file placed next to `index.js` with the key `DISCORD_TOKEN=your-token-here`
* In the `conf.toml` file, where you should already see `discord_token=""` <-- just put the token in the quotes

`git clone https://github.com/Spar3Chang3/Note-Ify.git`

`cd Note-Ify`

`bun install`

For running directly:

`bun index.js`

For compiling:

`bun build index.js --compile --outfile noteify`

`chmod +x noteify`

`./noteify`

---

## Confused?

If you're a GM looking for a solution like this, but don't know where to start, take a deep breath. You've already got a lot on your plate dealing with Ragnar III trying to romance the bartender for the 30th time. If you want a step by step tutorial with installing ollama, whisper.cpp, setting up a discord bot, and using this repo, check out this YouTube video:

# Coming Soon! Hold on tight guys, I'll be making one as soon as possible
