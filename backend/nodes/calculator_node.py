from asteval import Interpreter
from langchain_core.tools import tool

_aeval = Interpreter()

ALLOWED_NAMES = {
    k for k in dir(__builtins__) if k in {
        "abs", "round", "min", "max", "sum", "pow", "divmod"
    }
}


def safe_eval(expression: str) -> str:
    _aeval.symtable.clear()
    result = _aeval(expression)
    if _aeval.error:
        msgs = "; ".join(str(e.get_error()) for e in _aeval.error)
        return f"Error: {msgs}"
    return str(result)


def make_calculator_tool():
    @tool
    def evaluate_expression(expression: str) -> str:
        """Evaluate a math expression and return the numeric result."""
        return safe_eval(expression)

    return evaluate_expression
