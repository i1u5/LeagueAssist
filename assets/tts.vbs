if WScript.Arguments.Count = 0 then
    WScript.Echo "Nothing to say."
end if

ReDim arr(WScript.Arguments.Count-1)
For i = 0 To WScript.Arguments.Count-1
  arr(i) = WScript.Arguments(i)
Next

Set Zira = CreateObject("SAPI.spVoice")
Set Zira.Voice = Zira.GetVoices.Item(1)
Zira.Volume = 100


Zira.Speak Join(arr)