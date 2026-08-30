import { useState } from 'react'
import { Container, Row, Col, Form, Button, Alert } from 'react-bootstrap'
import toast from 'react-hot-toast'
import styled from 'styled-components'
import { useAccount } from '@/account/AccountContext'
import { submitProofOfInk } from '@/chain/bulletin'

const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2 MiB — matches the backend wallpaper cap.
const MAX_VIDEO_SIZE = 100 * 1024 * 1024 // 100 MiB inbound; the backend compresses it down.

/**
 * Submit a Proof-of-Ink: a wallpaper image for the gallery and a verification video for
 * human voting on Element.
 *
 * Eligibility (member/candidate) is read from `useAccount().level`, which reflects Society
 * state on Asset Hub Kusama — the app's own source, not the stale relay query the Apillon
 * page used. The backend re-checks membership authoritatively; this only gates the UI.
 * Path B means no funds and no Bulletin account are needed — just one off-chain signature.
 */
const SubmitPage = (): JSX.Element => {
  const { activeAccount, level, isLevelLoading, polkadotSigner, isSignerLoading } = useAccount()
  const [image, setImage] = useState<File | null>(null)
  const [video, setVideo] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const isMember = level === 'cyborg'
  const isCandidate = level === 'candidate'
  const isEligible = isMember || isCandidate

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Please select a valid image file (JPG or PNG)')
    if (file.size > MAX_IMAGE_SIZE) return toast.error('Image must be under 2MB. Please compress it first.')
    setImage(file)
  }

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) return toast.error('Please select a valid video file')
    if (file.size > MAX_VIDEO_SIZE) return toast.error('Video must be under 100MB.')
    setVideo(file)
  }

  const resetInputs = () => {
    setImage(null)
    setVideo(null)
    for (const id of ['image-input', 'video-input']) {
      const input = document.getElementById(id) as HTMLInputElement | null
      if (input) input.value = ''
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!activeAccount || !image || !video) return
    if (!isEligible) return toast.error('Only Society candidates and members can submit Proof-of-Ink')
    if (!polkadotSigner) return toast.error('Wallet signer not ready — reconnect your wallet and try again')

    setUploading(true)
    try {
      const result = await submitProofOfInk({ address: activeAccount.address, signer: polkadotSigner, image, video })
      toast.success(
        result.matrix.skipped
          ? 'Submitted! Your tattoo is stored and awaiting verification.'
          : 'Submitted! Your video was sent to the verification room.'
      )
      resetInputs()
    } catch (error) {
      toast.error(`Upload failed: ${(error as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  const isFormDisabled = !activeAccount || uploading || isLevelLoading || isSignerLoading || !isEligible

  return (
    <Container>
      <Row className="justify-content-center">
        <Col xs={12} md={8} lg={6}>
          <StyledCard>
            <h2 className="mb-4">Submit Proof-of-Ink</h2>

            {!activeAccount && (
              <Alert variant="warning">
                <strong>Wallet Not Connected</strong>
                <br />
                Please connect your wallet to submit your tattoo.
              </Alert>
            )}

            {activeAccount && !isLevelLoading && !isEligible && (
              <Alert variant="danger">
                <strong>Not Eligible</strong>
                <br />
                Only Society candidates and members can submit Proof-of-Ink. Please apply to join the Society first.
              </Alert>
            )}

            {activeAccount && !isLevelLoading && isCandidate && (
              <Alert variant="info">
                <strong>Candidate</strong>
                <br />
                Your submission goes to the verification room; your tattoo stays published while your candidacy stands.
              </Alert>
            )}

            {activeAccount && !isLevelLoading && isMember && (
              <Alert variant="success">
                <strong>Member</strong>
                <br />
                Your wallpaper will appear in the gallery and your video is sent for verification.
              </Alert>
            )}

            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3">
                <Form.Label>Wallpaper image</Form.Label>
                <Form.Control
                  id="image-input"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  disabled={isFormDisabled}
                />
                <Form.Text className="text-muted">Shown in the public gallery. JPG or PNG, max 2MB.</Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Verification video</Form.Label>
                <Form.Control
                  id="video-input"
                  type="file"
                  accept="video/*"
                  onChange={handleVideoChange}
                  disabled={isFormDisabled}
                />
                <Form.Text className="text-muted">
                  A short clip of the real tattoo on you, for human verification. Max 100MB; it is compressed on upload.
                </Form.Text>
              </Form.Group>

              <Button
                variant="primary"
                type="submit"
                disabled={isFormDisabled || !image || !video}
                className="w-100"
              >
                {uploading ? 'Uploading…' : 'Submit Proof-of-Ink'}
              </Button>
            </Form>
          </StyledCard>
        </Col>
      </Row>
    </Container>
  )
}

const StyledCard = styled.div`
  background-color: ${(props) => props.theme.colors.lightGrey};
  border-radius: 10px;
  padding: 2rem;
  margin-top: 2rem;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
`

export { SubmitPage }
