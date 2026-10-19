import { InputOTP, InputOTPGroup, InputOTPSlot } from '@giaokhoa/ui/components/input-otp';

export function AuthOtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-center">
      <InputOTP
        id="otp"
        name="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        onChange={onChange}
        disabled={disabled}
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}
