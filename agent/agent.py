"""A deep agent whose tools are designed to be *rendered* by the frontend.

The agent itself knows nothing about React. It just calls tools. The frontend
listens to the AG-UI event stream and decides how each tool call should look:

  1. get_weather   -> "tool-based" generative UI: the frontend maps the tool
                      name to a <WeatherCard/> and fills it with the result.
  2. render_chart  -> "declarative" generative UI: the agent describes a UI
                      (a chart spec) in the tool *arguments*; the frontend
                      draws it while the args are still streaming in.
  3. write_todos   -> planning tool (added via TodoListMiddleware). The todos live in graph
                      *state*, which AG-UI streams as STATE_SNAPSHOT events,
                      so the frontend can show a live plan panel.
  4. request_address -> interactive UI via interrupt(): the run *pauses*, the
                      frontend shows a form, and the user's answer becomes
                      the tool's return value when the run resumes.
"""

import os
import random
from typing import Literal

from deepagents import create_deep_agent
from langchain.agents.middleware import TodoListMiddleware
from langgraph.types import interrupt


def get_weather(city: str) -> dict:
    """Get the current weather for a city. Returns structured data that the UI renders as a card."""
    # Fake data so the example works offline / without extra API keys.
    rng = random.Random(city.lower())
    return {
        "city": city,
        "temperature_c": rng.randint(-5, 32),
        "condition": rng.choice(["sunny", "cloudy", "rainy", "snowy", "windy"]),
        "humidity": rng.randint(20, 95),
    }


def render_chart(
    title: str,
    labels: list[str],
    values: list[float],
    kind: Literal["bar", "line"] = "bar",
) -> str:
    """Show a chart to the user. Use whenever numbers would be clearer visually.

    The chart is drawn by the user's interface from these arguments, so you
    do not need to describe it again in text afterwards.
    """
    return f"Chart '{title}' with {len(values)} points was shown to the user."


def request_address(reason: str) -> dict:
    """Ask the user for a postal address using a form in their interface.

    Use this whenever you need an address (delivery, billing, visiting...).
    Never ask for an address in plain text. `reason` is shown above the form.
    """
    # interrupt() saves the graph state and ends the run. AG-UI reports it as
    # RUN_FINISHED with outcome "interrupt"; the payload below reaches the
    # frontend as interrupt.metadata.langgraph.raw. When the frontend resumes
    # the run, interrupt() returns whatever the user submitted.
    answer = interrupt({"form": "address", "message": reason})

    if isinstance(answer, dict) and answer.get("__agui_cancelled__"):
        return {"status": "declined", "note": "The user chose not to give an address."}
    return {"status": "provided", "address": answer}


SYSTEM_PROMPT = """You are a helpful assistant inside a demo app about generative UI.

- For anything multi-step, first plan with the write_todos tool and keep the todos updated as you go.
- Use get_weather for weather questions (the UI renders a weather card, so keep your text short).
- Use render_chart whenever a comparison or series of numbers would help.
- Use request_address whenever you need the user's address (e.g. to order or deliver something).
  Ordering itself is simulated: once you have an address, just confirm the (pretend) order.
"""

agent = create_deep_agent(
    model=os.environ.get("MODEL", "anthropic:claude-haiku-5-5"),
    tools=[get_weather, render_chart, request_address],
    system_prompt=SYSTEM_PROMPT,
    # Recent deepagents versions no longer add the `write_todos` planning tool
    # by default. This middleware adds it back and keeps `todos` in state.
    middleware=[TodoListMiddleware()],
)
