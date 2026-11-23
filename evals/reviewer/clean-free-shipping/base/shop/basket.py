def basket_total(lines) -> int:
    """Total of (unit_pence, quantity) lines, in pence."""
    return sum(unit * qty for unit, qty in lines)
