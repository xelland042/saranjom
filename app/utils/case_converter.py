def camel_case_to_snake_case(input_str: str) -> str:
    """
    Converts string in camel case into snake case, f.e:
    'SomeSDK' -> 'some_sdk'
    'RServoDrive' -> 'r_servo_drive'
    'SDKDemo' -> 'sdk_demo'
    """
    chars = []
    for c_idx, char in enumerate(input_str):
        if c_idx and char.isupper():
            nxt_isx = c_idx + 1
            flag = nxt_isx >= len(input_str) or input_str[nxt_isx].isupper()
            prev_char = input_str[c_idx - 1]
            if prev_char.isupper() and flag:
                pass
            else:
                chars.append("_")
        chars.append(char.lower())
    return "".join(chars)
